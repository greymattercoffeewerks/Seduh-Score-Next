#!/usr/bin/env node
// One local Supabase stack is shared by every worktree on this machine (and so by every Claude session working in
// one). Two sessions resetting it, or one resetting it while another runs pgTAP, gave wrong-schema runs and a
// 20-minute pile-up on 2026-11-18. This is the lock that stops that.
//
// It is a reader/writer lock kept as files in the git common directory (`git rev-parse --git-common-dir`), which every
// worktree of this repository shares:
//   * exclusive (writer): anything that changes the shared `postgres` database or restarts the stack (`db:reset`,
//     `db:test:shared`, a Playwright run). One at a time, and only once no shared holder is left.
//   * shared (reader): a pgTAP run in a worktree's OWN database (tools/db-test.mjs). Many at once; they only need the
//     stack not to be restarted under them (a `db:reset` recreates the database container, which drops every
//     per-worktree database too).
// A holder records its process id. A holder whose process is gone, or that is older than its age cap, is stale and is
// cleared by the next caller, so a crashed or killed run never blocks the queue for good.
//
// Not a Postgres advisory lock on purpose: `supabase db reset` recreates the database, which would drop the lock with it.
//
// CLI:
//   node tools/db-lock.mjs status
//   node tools/db-lock.mjs run [--shared] [--wait-mins N] -- <command> [args...]
//   node tools/db-lock.mjs clear            (removes every holder; only for a lock you know is wrong)
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const POLL_MS = 2000;
const REPORT_EVERY_MS = 30000;
// A holder older than this is treated as stale even if its process still exists (a hung run must not hold forever).
const MAX_AGE_MS = { exclusive: 45 * 60 * 1000, shared: 30 * 60 * 1000 };

export function lockDir(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return path.join(path.resolve(cwd, common), 'seduh-db-lock');
}

export function worktreeName(cwd = process.cwd()) {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return path.basename(top);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// A holder is live while its process exists and it is younger than its cap. An unreadable holder file (a writer that
// died between mkdir and writing it) gets a short grace period from the file's own time, then counts as stale.
function isLive(info, kind, statPath) {
  const now = Date.now();
  if (!info) {
    try {
      return now - fs.statSync(statPath).mtimeMs < 10000;
    } catch {
      return false;
    }
  }
  // The wrapper's child counts too: on Windows a `taskkill` of the node wrapper (without /T) leaves its cmd.exe and the
  // command it runs alive, so the hold must stay while either lives.
  const alive = pidAlive(info.pid) || (info.childPid ? pidAlive(info.childPid) : false);
  return alive && now - info.startedAt < MAX_AGE_MS[kind];
}

// Removes the writer slot only if it still belongs to `token`. The slot is first renamed to a unique name, which only one
// caller can do, and its owner is checked AFTER the rename: if another holder took the slot in between, it is put back.
// (A plain check-then-delete let a stale-clearer or a late release delete a slot someone else had just taken.)
function removeWriterIfOwner(dir, token) {
  const slot = path.join(dir, 'writer');
  if (readJson(path.join(slot, 'owner.json'))?.token !== token) return false;
  const tomb = path.join(dir, `writer.gone-${randomBytes(6).toString('hex')}`);
  try {
    fs.renameSync(slot, tomb);
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
  if (readJson(path.join(tomb, 'owner.json'))?.token === token) {
    fs.rmSync(tomb, { recursive: true, force: true });
    return true;
  }
  try {
    fs.renameSync(tomb, slot);
  } catch {
    // A third writer took the slot meanwhile; the one we moved re-checks its ownership and starts over.
    fs.rmSync(tomb, { recursive: true, force: true });
  }
  return false;
}

function describe(info) {
  if (!info) return 'a holder that is still starting';
  const mins = ((Date.now() - info.startedAt) / 60000).toFixed(1);
  const child = info.childPid ? `, child ${info.childPid}` : '';
  return `${info.worktree} (pid ${info.pid}${child}, ${mins} min, "${info.command}")`;
}

export function readHolders(dir) {
  const writerDir = path.join(dir, 'writer');
  const out = { writer: null, readers: [] };
  if (fs.existsSync(writerDir)) {
    const info = readJson(path.join(writerDir, 'owner.json'));
    out.writer = { info, path: writerDir, live: isLive(info, 'exclusive', writerDir) };
  }
  const readersDir = path.join(dir, 'readers');
  if (fs.existsSync(readersDir)) {
    for (const f of fs.readdirSync(readersDir)) {
      const p = path.join(readersDir, f);
      const info = readJson(p);
      out.readers.push({ info, path: p, live: isLive(info, 'shared', p) });
    }
  }
  return out;
}

function clearStale(dir, holders, log) {
  if (holders.writer && !holders.writer.live) {
    if (removeWriterIfOwner(dir, holders.writer.info?.token)) {
      log(`clearing a stale exclusive hold: ${describe(holders.writer.info)}`);
    }
    holders.writer = fs.existsSync(path.join(dir, 'writer')) ? holders.writer : null;
  }
  holders.readers = holders.readers.filter((r) => {
    if (r.live) return true;
    log(`clearing a stale shared hold: ${describe(r.info)}`);
    fs.rmSync(r.path, { force: true });
    return false;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Takes the lock and returns a release() function. Throws if it cannot get it within waitMs.
export async function acquire({
  kind = 'exclusive',
  command = '',
  waitMs = 30 * 60 * 1000,
  log = console.error,
} = {}) {
  const dir = lockDir();
  fs.mkdirSync(path.join(dir, 'readers'), { recursive: true });
  const token = randomBytes(8).toString('hex');
  const info = {
    pid: process.pid,
    token,
    worktree: worktreeName(),
    command,
    kind,
    startedAt: Date.now(),
  };
  const writerFile = path.join(dir, 'writer', 'owner.json');
  const ownsWriter = () => readJson(writerFile)?.token === token;
  const deadline = Date.now() + waitMs;
  let lastReport = 0;
  let mine = null;

  const drop = () => {
    if (!mine) return;
    if (kind === 'exclusive') removeWriterIfOwner(dir, token);
    else fs.rmSync(mine, { force: true });
    mine = null;
  };

  const waiting = (why) => {
    if (Date.now() - lastReport >= REPORT_EVERY_MS) {
      log(`[db-lock] waiting for the local database: ${why}`);
      lastReport = Date.now();
    }
    if (Date.now() > deadline) {
      drop();
      throw new Error(`[db-lock] gave up after ${Math.round(waitMs / 60000)} min: ${why}`);
    }
  };

  for (;;) {
    const h = readHolders(dir);
    clearStale(dir, h, (m) => log(`[db-lock] ${m}`));
    if (kind === 'exclusive') {
      if (mine && !ownsWriter()) mine = null; // our slot was cleared under us: queue again
      if (!mine) {
        try {
          fs.mkdirSync(path.join(dir, 'writer'));
          info.startedAt = Date.now();
          fs.writeFileSync(writerFile, JSON.stringify(info));
          mine = path.join(dir, 'writer');
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          waiting(`held by ${describe(h.writer?.info)}`);
          await sleep(POLL_MS);
          continue;
        }
      }
      // Writer slot is ours; new readers now wait. Wait for the ones already in to finish.
      const live = readHolders(dir).readers.filter((r) => r.live);
      if (live.length === 0) {
        // The hold's age is counted from now, not from when we started waiting.
        info.startedAt = Date.now();
        fs.writeFileSync(writerFile, JSON.stringify(info));
        if (ownsWriter()) break;
        mine = null;
        continue;
      }
      waiting(
        `${live.length} pgTAP run(s) still using it: ${live.map((r) => describe(r.info)).join('; ')}`,
      );
      await sleep(POLL_MS);
    } else {
      if (h.writer) {
        waiting(`held by ${describe(h.writer.info)}`);
        await sleep(POLL_MS);
        continue;
      }
      mine = path.join(dir, 'readers', `${process.pid}-${token}.json`);
      info.startedAt = Date.now();
      fs.writeFileSync(mine, JSON.stringify(info));
      // A writer may have taken its slot between our check and our write; it waits for us, but we step back for it so
      // the two never both proceed.
      if (fs.existsSync(path.join(dir, 'writer'))) {
        fs.rmSync(mine, { force: true });
        mine = null;
        await sleep(POLL_MS);
        continue;
      }
      break;
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    drop();
  };
  // Records extra holder fields (the wrapper's child pid), only while the hold is still ours.
  release.update = (extra) => {
    Object.assign(info, extra);
    if (kind === 'exclusive' ? ownsWriter() : mine && fs.existsSync(mine)) {
      fs.writeFileSync(kind === 'exclusive' ? writerFile : mine, JSON.stringify(info));
    }
  };
  process.on('exit', release);
  return release;
}

function winQuote(a) {
  return /^[\w./:=@-]+$/.test(a)
    ? a
    : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// Runs a command while holding the lock and exits with its exit code. Ctrl-C or a kill releases the lock (the exit
// handler), and a hard kill leaves a dead pid that the next caller clears.
async function runLocked(kind, waitMs, cmd, args) {
  const command = [cmd, ...args].join(' ');
  const release = await acquire({ kind, command, waitMs });
  console.error(`[db-lock] ${kind} hold taken for: ${command}`);
  // On Windows `supabase`/`npm` are .cmd shims, which need a shell; hand cmd.exe ONE quoted command line (passing an
  // args array with shell:true joins them unquoted, so spaces and quotes were mangled).
  const child =
    process.platform === 'win32'
      ? spawn([cmd, ...args].map(winQuote).join(' '), { stdio: 'inherit', shell: true })
      : spawn(cmd, args, { stdio: 'inherit' });
  if (child.pid) release.update({ childPid: child.pid });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      child.kill(sig);
      release();
      process.exit(130);
    });
  }
  child.on('exit', (code, signal) => {
    release();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'status') {
    const h = readHolders(lockDir());
    if (!h.writer && h.readers.length === 0) return console.log('free');
    if (h.writer)
      console.log(`exclusive: ${describe(h.writer.info)}${h.writer.live ? '' : ' [stale]'}`);
    for (const r of h.readers)
      console.log(`shared: ${describe(r.info)}${r.live ? '' : ' [stale]'}`);
    return;
  }
  if (sub === 'clear') {
    fs.rmSync(lockDir(), { recursive: true, force: true });
    return console.log('cleared');
  }
  if (sub === 'run') {
    const sep = rest.indexOf('--');
    if (sep < 0 || sep === rest.length - 1)
      throw new Error('usage: db-lock.mjs run [--shared] [--wait-mins N] -- <command>');
    const opts = rest.slice(0, sep);
    const [cmd, ...args] = rest.slice(sep + 1);
    const w = opts.indexOf('--wait-mins');
    const waitMs = (w >= 0 ? Number(opts[w + 1]) : 30) * 60 * 1000;
    return runLocked(opts.includes('--shared') ? 'shared' : 'exclusive', waitMs, cmd, args);
  }
  throw new Error(
    'usage: db-lock.mjs status | clear | run [--shared] [--wait-mins N] -- <command>',
  );
}

// Run as a command only when this file is the entry point (db-test.mjs imports it).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

#!/usr/bin/env node
// pgTAP in this worktree's OWN database, so parallel sessions stop resetting each other's schema.
//
// The local Supabase stack runs one Postgres container shared by every worktree. `supabase test db` and
// `supabase db reset` only ever use its `postgres` database, so before this script two sessions took turns overwriting
// it (2026-11-18: a run tested another branch's schema, and a killed run's query held locks for 20 minutes). Now each
// worktree gets a database of its own in the same container, `seduh_wt_<worktree>`:
//
//   1. A clean base: Supabase's own schemas (auth, storage, extensions, vault, ...) with NONE of our migrations. Built
//      once per Postgres image by starting a throwaway second Supabase project with no migrations (separate ports,
//      only db/auth/storage/rest/kong), dumping its database, and stopping it. Kept in the git common dir, shared by
//      every worktree.
//   2. This worktree's database = that base restored, then this worktree's migrations and seed.sql applied with psql.
//      A fingerprint of the migrations, the seed and the base is stored as the database's comment; the next run skips
//      the rebuild while it still matches, so most runs go straight to the tests.
//   3. pgTAP runs with the same pg_prove image the CLI uses, against this database only.
//
// Do NOT point `supabase db reset --db-url` at a per-worktree database: the CLI sees 127.0.0.1:54422 as "local" and
// resets the shared database and restarts the stack instead (found the hard way while building this).
//
// The run holds a SHARED db-lock hold (tools/db-lock.mjs): any number of these run side by side, but a `db:reset`
// (exclusive) waits for them, because recreating the database container drops every per-worktree database.
//
// Usage: npm run db:test [-- [--rebuild] [--timeout-mins N] [supabase/tests/0xx_name.sql ...]]
//        npm run db:test -- --drop        (drop this worktree's database)
//        npm run db:test -- --prune       (drop the databases of worktrees that no longer exist)
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { acquire, lockDir, worktreeName } from './db-lock.mjs';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const SUPA = path.join(ROOT, 'supabase');
const PROJECT_ID = /^project_id\s*=\s*"([^"]+)"/m.exec(
  fs.readFileSync(path.join(SUPA, 'config.toml'), 'utf8'),
)[1];
const DB_CONTAINER = `supabase_db_${PROJECT_ID}`;
const NETWORK = `supabase_network_${PROJECT_ID}`;
const STORE = path.join(path.dirname(lockDir()), 'seduh-db');
const BASE_PROJECT = 'seduh-pgtap-base';
const PG_PROVE_IMAGE = 'public.ecr.aws/supabase/pg_prove:3.36';
// Applied to the per-worktree database only (never the shared one): a stuck statement fails instead of hanging.
const STATEMENT_TIMEOUT = '120s';
const LOCK_TIMEOUT = '30s';

const log = (m) => console.error(`[db-test] ${m}`);

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

// psql inside the shared db container. `input` is fed on stdin.
function psql(db, sql, { user = 'supabase_admin', input, quiet = true } = {}) {
  const args = [
    'exec',
    '-i',
    DB_CONTAINER,
    'psql',
    '-U',
    user,
    '-d',
    db,
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
  ];
  if (quiet) args.push('-q');
  if (sql) args.push('-c', sql);
  return sh('docker', args, { input: input ?? '' }).trim();
}

function dbName() {
  const slug = worktreeName()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `seduh_wt_${slug}`.slice(0, 63);
}

function containerImage(name) {
  return sh('docker', ['inspect', '-f', '{{.Config.Image}}', name]).trim();
}

function requireStack() {
  try {
    if (sh('docker', ['inspect', '-f', '{{.State.Running}}', DB_CONTAINER]).trim() === 'true')
      return;
  } catch {
    /* fall through */
  }
  throw new Error(
    `the local stack is not running (no ${DB_CONTAINER}); start it with: npm run supabase -- start`,
  );
}

// ---------- 1. the clean base ----------

function basePath() {
  const tag = containerImage(DB_CONTAINER).split(':').pop();
  return path.join(STORE, `base-${tag}.dump`);
}

async function ensureBase() {
  const target = basePath();
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(STORE, { recursive: true });
  // One builder at a time: the base project has fixed ports and a fixed name.
  const guard = path.join(STORE, 'base-build');
  for (;;) {
    try {
      fs.mkdirSync(guard);
      fs.writeFileSync(path.join(guard, 'pid'), String(process.pid));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(path.join(guard, 'pid'), 'utf8') || 0);
      } catch {
        // The other builder made the folder but has not written its pid yet.
      }
      let alive = !pid && Date.now() - fs.statSync(guard).mtimeMs < 10000;
      if (pid) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch (err) {
          alive = err.code === 'EPERM';
        }
      }
      if (!alive) fs.rmSync(guard, { recursive: true, force: true });
      else await new Promise((r) => setTimeout(r, 3000));
      if (fs.existsSync(target)) return target;
    }
  }
  try {
    if (fs.existsSync(target)) return target;
    log('building the clean base database (once per Postgres image, about a minute)...');
    const work = path.join(STORE, 'base-project');
    fs.mkdirSync(path.join(work, 'supabase'), { recursive: true });
    fs.writeFileSync(
      path.join(work, 'supabase', 'config.toml'),
      [
        `project_id = "${BASE_PROJECT}"`,
        '[api]\nenabled = true\nport = 54621',
        '[db]\nport = 54622\nshadow_port = 54620\nmajor_version = 17',
        '[db.migrations]\nenabled = false',
        '[db.seed]\nenabled = false',
        '[realtime]\nenabled = false',
        '[studio]\nenabled = false',
        '[inbucket]\nenabled = false',
        '[storage]\nenabled = true',
        '[auth]\nenabled = true\nsite_url = "http://127.0.0.1:3000"',
        '[edge_runtime]\nenabled = false',
        '[analytics]\nenabled = false',
        '',
      ].join('\n'),
    );
    const exclude =
      'studio,imgproxy,mailpit,realtime,edge-runtime,logflare,vector,postgres-meta,supavisor';
    // Through npx so a worktree without its own node_modules still finds the repo's pinned CLI.
    const run = (args) =>
      sh('npx', ['supabase', ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    try {
      run(['start', '--workdir', work, '-x', exclude]);
      const baseContainer = `supabase_db_${BASE_PROJECT}`;
      if (containerImage(baseContainer) !== containerImage(DB_CONTAINER)) {
        throw new Error(
          `the base project started ${containerImage(baseContainer)} but the shared stack runs ` +
            `${containerImage(DB_CONTAINER)}; restart the shared stack with this CLI version first`,
        );
      }
      // auth and storage create their schemas when their services start; wait until both have run their own
      // migrations to the end (the counts hold still between two polls). A base without them would be cached for good.
      let previous = null;
      let settled = false;
      for (let i = 0; i < 90 && !settled; i++) {
        const ready = sh('docker', [
          'exec',
          baseContainer,
          'psql',
          '-U',
          'supabase_admin',
          '-d',
          'postgres',
          '-Atc',
          "select case when to_regclass('auth.schema_migrations') is not null and to_regclass('storage.migrations') is not null " +
            "and to_regclass('auth.users') is not null and to_regclass('storage.objects') is not null " +
            "then (select count(*) from auth.schema_migrations) || '/' || (select count(*) from storage.migrations) end",
        ]).trim();
        settled = ready !== '' && ready === previous;
        previous = ready;
        if (!settled) await new Promise((r) => setTimeout(r, 2000));
      }
      if (!settled) {
        throw new Error(
          'auth and storage did not finish setting up in the base project within 3 minutes; try again',
        );
      }
      const dump = execFileSync(
        'docker',
        ['exec', baseContainer, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc'],
        { maxBuffer: 256 * 1024 * 1024 },
      );
      fs.writeFileSync(`${target}.tmp`, dump);
      fs.renameSync(`${target}.tmp`, target);
    } finally {
      try {
        run(['stop', '--workdir', work, '--no-backup']);
      } catch (e) {
        log(
          `could not stop the base project (${e.message.split('\n')[0]}); stop it with: supabase stop --workdir "${work}" --no-backup`,
        );
      }
    }
    log(`base saved: ${target}`);
    return target;
  } finally {
    fs.rmSync(guard, { recursive: true, force: true });
  }
}

// ---------- 2. this worktree's database ----------

function migrationFiles() {
  const dir = path.join(SUPA, 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(dir, f));
}

function fingerprint(base) {
  const h = createHash('sha256');
  h.update(path.basename(base));
  for (const f of [...migrationFiles(), path.join(SUPA, 'seed.sql')]) {
    h.update(path.basename(f));
    h.update(fs.readFileSync(f));
  }
  return `seduh-fp:${h.digest('hex').slice(0, 32)}`;
}

function quoteIdent(s) {
  return `"${s.replace(/"/g, '""')}"`;
}

function terminateBackends(db) {
  psql(
    'postgres',
    `select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = '${db}' and pid <> pg_backend_pid()`,
  );
}

function dbExists(db) {
  return psql('postgres', `select 1 from pg_database where datname = '${db}'`) === '1';
}

function dropDb(db) {
  if (!dbExists(db)) return false;
  terminateBackends(db);
  psql('postgres', `drop database ${quoteIdent(db)} with (force)`);
  return true;
}

function build(db, base, fp) {
  const started = Date.now();
  dropDb(db);
  psql('postgres', `create database ${quoteIdent(db)} owner postgres`);
  // Settings scoped to the `postgres` database (the JWT secret the API services read) do not travel with a dump; copy
  // them. Role-wide settings (search_path, statement timeouts of anon/authenticated) are cluster-wide already.
  const dbSettings = psql(
    'postgres',
    "select unnest(setconfig) from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase where d.datname = 'postgres' and s.setrole = 0",
  );
  for (const kv of dbSettings.split('\n').filter(Boolean)) {
    const i = kv.indexOf('=');
    const key = kv.slice(0, i);
    const value = kv.slice(i + 1).replace(/'/g, "''");
    psql('postgres', `alter database ${quoteIdent(db)} set ${key} = '${value}'`);
  }
  execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'pg_restore', '-U', 'supabase_admin', '-d', db, '--exit-on-error'],
    {
      input: fs.readFileSync(base),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  // Each migration in its own transaction, in file order, as the postgres role (who owns them in the shared database
  // too), then the seed. One psql session: stops at the first error and names the file.
  const parts = ['\\set ON_ERROR_STOP 1'];
  for (const f of migrationFiles()) {
    parts.push(
      `\\echo 'applying ${path.basename(f)}'`,
      'begin;',
      fs.readFileSync(f, 'utf8'),
      ';',
      'commit;',
    );
  }
  parts.push(
    "\\echo 'applying seed.sql'",
    fs.readFileSync(path.join(SUPA, 'seed.sql'), 'utf8'),
    ';',
  );
  try {
    execFileSync(
      'docker',
      ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-q', '-X'],
      {
        input: parts.join('\n'),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (e) {
    const out = `${e.stdout ?? ''}`.trim().split('\n');
    const last = out.reverse().find((l) => l.startsWith('applying ')) ?? '(before the first file)';
    dropDb(db);
    throw new Error(`migration failed while ${last}:\n${`${e.stderr ?? ''}`.trim()}`);
  }
  psql(db, 'create extension if not exists pgtap with schema extensions');
  psql(
    'postgres',
    `alter database ${quoteIdent(db)} set statement_timeout = '${STATEMENT_TIMEOUT}'`,
  );
  psql('postgres', `alter database ${quoteIdent(db)} set lock_timeout = '${LOCK_TIMEOUT}'`);
  psql('postgres', `comment on database ${quoteIdent(db)} is '${fp}'`);
  log(`built ${db} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// ---------- 3. pgTAP ----------

function runProve(db, files, timeoutMins) {
  const testsDir = path.join(SUPA, 'tests');
  const name = `seduh_pgtap_${db}`.slice(0, 60);
  const targets = files.length
    ? files.map(
        (f) => `/tests/${path.relative(testsDir, path.resolve(ROOT, f)).replace(/\\/g, '/')}`,
      )
    : ['/tests'];
  for (const t of targets) {
    if (t.includes('..')) throw new Error(`not a file under supabase/tests: ${t}`);
  }
  // A leftover container or query from a killed earlier run of THIS worktree would hold this database's locks.
  try {
    sh('docker', ['rm', '-f', name], { stdio: 'ignore' });
  } catch {
    /* none */
  }
  terminateBackends(db);
  const args = [
    'run', '--rm', '--name', name, '--network', NETWORK,
    '-v', `${testsDir}:/tests:ro`,
    '-e', 'PGPASSWORD=postgres',
    PG_PROVE_IMAGE,
    'pg_prove', '--ext', '.sql', '--ext', '.pg', '-r',
    '-h', DB_CONTAINER, '-p', '5432', '-U', 'postgres', '-d', db,
    ...targets,
  ]; // prettier-ignore
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: 'inherit' });
    const timer = setTimeout(
      () => {
        log(`timed out after ${timeoutMins} min; stopping the run and its queries in ${db}`);
        try {
          sh('docker', ['rm', '-f', name], { stdio: 'ignore' });
        } catch {
          /* already gone */
        }
        terminateBackends(db);
      },
      timeoutMins * 60 * 1000,
    );
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

// ---------- main ----------

async function main(argv) {
  requireStack();
  const db = dbName();
  if (argv.includes('--drop')) {
    const release = await acquire({ kind: 'shared', command: 'db:test --drop' });
    log(dropDb(db) ? `dropped ${db}` : `${db} does not exist`);
    release();
    return 0;
  }
  if (argv.includes('--prune')) {
    const release = await acquire({ kind: 'shared', command: 'db:test --prune' });
    const live = new Set(
      sh('git', ['worktree', 'list', '--porcelain'])
        .split('\n')
        .filter((l) => l.startsWith('worktree '))
        .map((l) =>
          `seduh_wt_${path
            .basename(l.slice(9))
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')}`.slice(0, 63),
        ),
    );
    for (const d of psql(
      'postgres',
      "select datname from pg_database where datname like 'seduh\\_wt\\_%'",
    )
      .split('\n')
      .filter(Boolean)) {
      if (!live.has(d)) {
        dropDb(d);
        log(`dropped ${d} (its worktree is gone)`);
      }
    }
    release();
    return 0;
  }
  const t = argv.indexOf('--timeout-mins');
  const timeoutMins = t >= 0 ? Number(argv[t + 1]) : 15;
  // The shared hold goes stale after 30 minutes (db-lock.mjs); a longer run would let a reset recreate the container
  // under it. The build counts against the same hold, so leave room for it.
  if (!(timeoutMins > 0 && timeoutMins <= 25)) {
    throw new Error('--timeout-mins must be between 1 and 25');
  }
  const files = argv.filter((a, i) => !a.startsWith('--') && !(t >= 0 && i === t + 1));

  const release = await acquire({ kind: 'shared', command: `db:test ${argv.join(' ')}`.trim() });
  try {
    const base = await ensureBase();
    const fp = fingerprint(base);
    const current = dbExists(db)
      ? psql(
          'postgres',
          `select shobj_description(oid, 'pg_database') from pg_database where datname = '${db}'`,
        )
      : null;
    if (argv.includes('--rebuild') || current !== fp) {
      log(
        current ? `migrations changed since the last build of ${db}; rebuilding` : `building ${db}`,
      );
      build(db, base, fp);
    } else {
      log(`${db} is up to date with this worktree's migrations; skipping the rebuild`);
    }
    return await runProve(db, files, timeoutMins);
  } finally {
    release();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[db-test] ${e.message}`);
    process.exit(1);
  },
);

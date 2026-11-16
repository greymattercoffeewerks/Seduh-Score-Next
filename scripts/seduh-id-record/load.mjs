#!/usr/bin/env node
// Seduh ID Layer 2, T-ID2.D-a: load a person's own competition record. Runbook: CONVENTIONS.md, "Seduh ID: a person's own record".
//
//   node scripts/seduh-id-record/load.mjs --csv <record.csv> --handle <handle> [--competition btc] [--write-sql <out.sql>]
//
// Without --write-sql nothing is written anywhere: it prints the problems and what a load would do. With --write-sql it writes the
// SQL only when there are no errors, and only to a place that cannot be committed by accident: scripts/seduh-id-record/out/
// (gitignored) or a folder outside the repository. It never connects to a database; the owner reads the SQL, then runs it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecord, summarise, toSql, isHandle } from './lib.mjs';

const FLAGS = new Set(['csv', 'handle', 'competition', 'write-sql']);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = resolve(HERE, 'out');

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`);
    const name = a.slice(2);
    if (!FLAGS.has(name)) throw new Error(`unknown option --${name}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    out[name] = value;
    i += 1;
  }
  return out;
}

// true when the path is inside the repository but not under out/ (a place a careless `git add` could reach)
export function unsafeOutputPath(file, { repo = REPO, out = OUT } = {}) {
  const target = resolve(file);
  const inside = (base) => {
    const rel = relative(base, target);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  };
  return inside(repo) && !inside(out);
}

export function run(argv, log = console.log, opts = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log(
      `${e.message}\nusage: node scripts/seduh-id-record/load.mjs --csv <record.csv> --handle <handle> [--competition btc] [--write-sql <out.sql>]`,
    );
    return 2;
  }
  if (!args.csv || !args.handle) {
    log('--csv and --handle are required');
    return 2;
  }
  if (!isHandle(args.handle)) {
    log(
      `"${args.handle}" is not a Seduh ID handle (3 to 30 lower-case letters, digits and single hyphens)`,
    );
    return 2;
  }
  const data = buildRecord({
    csvText: readFileSync(args.csv, 'utf8'),
    competition: args.competition ?? 'btc',
    currentYear: opts.currentYear,
  });
  for (const e of data.errors) log(`ERROR   ${e}`);
  for (const w of data.warnings) log(`WARNING ${w}`);
  const s = summarise(data);
  const kinds = Object.entries(s.byKind)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  log(
    `${s.entries} entries (${kinds}; ${s.placements} with a placing read from the result text) and ${s.links} team link(s), each starting as self-reported.`,
  );
  for (const l of data.links)
    log(`  team link: ${l.team_name} (${l.country_code}) ${l.edition_year} as ${l.role}`);
  if (data.errors.length > 0) {
    log(`${data.errors.length} error(s): fix the CSV and run again. Nothing was written.`);
    return 1;
  }
  if (!args['write-sql']) {
    log('Preview only: nothing written. Add --write-sql <file> to write the SQL.');
    return 0;
  }
  if (unsafeOutputPath(args['write-sql'], opts)) {
    log(
      `Refusing to write inside the repository outside scripts/seduh-id-record/out/ (the SQL holds a real person's record): ${args['write-sql']}`,
    );
    return 2;
  }
  const sql = toSql(data, {
    handle: args.handle,
    summary: `${s.entries} entries, ${s.links} team links`,
  });
  mkdirSync(dirname(resolve(args['write-sql'])), { recursive: true });
  writeFileSync(args['write-sql'], sql, 'utf8');
  log(
    `Wrote ${args['write-sql']}. Read it, then run it as owner SQL (CONVENTIONS.md). Never commit it.`,
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}

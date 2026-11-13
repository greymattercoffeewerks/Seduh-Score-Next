#!/usr/bin/env node
// Seduh ID country pages, T-CTY.2: validate an organiser's historical results and (only with --write-sql) write the load
// SQL. Runbook: CONVENTIONS.md, "Country history: the owner's runbook".
//
//   node scripts/country-history/import.mjs --template <file.csv> [--rounds <rounds.csv>]
//        [--permission-ref "<who allowed it, and when>"] [--supplied-on YYYY-MM-DD] [--competition btc]
//        [--write-sql <out.sql>]
//
// Without --write-sql nothing is written anywhere: it prints the problems (errors block a load, warnings are for the
// owner to decide) and the counts a load would produce. With --write-sql it writes the SQL only when there are no errors.
// It never connects to a database. The SQL holds real results: write it OUTSIDE the repository (or into
// scripts/country-history/out/, which is gitignored) and never commit it.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, summarise, toSql } from './lib.mjs';

const FLAGS = new Set([
  'template',
  'rounds',
  'permission-ref',
  'supplied-on',
  'competition',
  'write-sql',
]);

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

export function run(argv, log = console.log) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log(
      `${e.message}\nusage: node scripts/country-history/import.mjs --template <file.csv> [--rounds <file.csv>] [--permission-ref "..."] [--supplied-on YYYY-MM-DD] [--write-sql <out.sql>]`,
    );
    return 2;
  }
  if (!args.template) {
    log('--template is required');
    return 2;
  }
  const templateText = readFileSync(args.template, 'utf8');
  const roundsText = args.rounds ? readFileSync(args.rounds, 'utf8') : undefined;
  const data = buildDataset({
    templateText,
    roundsText,
    templateName: basename(args.template),
    options: {
      competition: args.competition,
      permissionRef: args['permission-ref'],
      suppliedOn: args['supplied-on'],
    },
  });

  for (const w of data.warnings) log(`WARNING  ${w}`);
  for (const e of data.errors) log(`ERROR    ${e}`);
  const s = summarise(data);
  log(
    `\n${data.results.length} result row(s), ${data.rounds.length} round row(s), ${data.errors.length} error(s), ${data.warnings.length} warning(s)`,
  );
  for (const y of s.perYear)
    log(
      `  ${y.year}: ${y.entries} team entries from ${y.countries} countries, ${y.rounds} round scores`,
    );
  for (const c of s.perCountry)
    log(`  ${c.code}: ${c.teams} team(s), ${c.entries} entries, ${c.years} year(s)`);

  if (data.errors.length > 0) {
    log('\nNothing written: fix the errors above (they block a load).');
    return 1;
  }
  if (!args['write-sql']) {
    log('\nPreview only: nothing was written. Add --write-sql <file> to write the load SQL.');
    return 0;
  }
  const out = resolve(args['write-sql']);
  const sql = toSql(data, {
    summary: `${data.results.length} result row(s), ${data.rounds.length} round row(s) from ${basename(args.template)}${args.rounds ? ` and ${basename(args.rounds)}` : ''}`,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, sql, 'utf8');
  log(`\nWrote ${out}. It holds real results: do not commit it.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}

// Turns the owner's LOCAL profanity CSV into one SQL statement that loads it into app.seduh_handle_blocklist (kind 'profanity').
// The words never live in the (public) repository: this tool only reads a file you point it at and prints SQL to stdout.
//
//   node tools/seduh-handle-blocklist-sql.mjs "Handoffs and Specs/seduh-handle-profanity-DRAFT.csv" > load-profanity.sql
//
// CSV: a header row, then `term,match_mode,language,note` (language and note optional). Lines starting with # and blank lines are
// skipped. Every row is checked against the same rules as the table's check constraints, and the whole file is refused on the
// first bad row (nothing is half-loaded). The SQL it prints is one transaction: an upsert, so loading twice changes nothing,
// and a changed match_mode or note is updated.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MODES = ['exact', 'contains'];

/** Pure. One CSV line to cells (no quoted-comma support: terms are plain letters and digits; a note may not contain a comma). */
function cells(line) {
  return line.split(',').map((c) => c.trim());
}

/** Pure. Parses the CSV text into rows, or throws an Error naming the line. */
export function parseProfanityCsv(text) {
  const rows = [];
  const seen = new Set();
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  let header = null;
  lines.forEach((line, i) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    const c = cells(line);
    if (!header) {
      header = c.map((h) => h.toLowerCase());
      if (header[0] !== 'term' || header[1] !== 'match_mode') {
        throw new Error(`line ${i + 1}: the header must start with term,match_mode`);
      }
      return;
    }
    if (c.length > 4)
      throw new Error(`line ${i + 1}: more than 4 cells (a note may not contain a comma)`);
    const [term, mode, language = '', note = ''] = c;
    const where = `line ${i + 1}`;
    if (!/^[a-z0-9]{3,30}$/.test(term ?? ''))
      throw new Error(`${where}: the term must be 3 to 30 lowercase letters or digits`);
    if (!MODES.includes(mode)) throw new Error(`${where}: match_mode must be exact or contains`);
    if (mode === 'contains' && term.length < 4)
      throw new Error(`${where}: a contains term needs 4 or more characters`);
    if (!/^[a-z]{0,10}$/.test(language))
      throw new Error(`${where}: the language must be a short lowercase code`);
    if (seen.has(term)) throw new Error(`${where}: ${term} appears twice`);
    seen.add(term);
    const label = [language && `lang ${language}`, note].filter(Boolean).join('; ');
    if (label.length > 200) throw new Error(`${where}: the note is longer than 200 characters`);
    rows.push({ term, mode, language, note: label });
  });
  if (!header) throw new Error('the file has no header row');
  if (rows.length === 0) throw new Error('the file has no rows');
  return rows;
}

function lit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Pure. The SQL for the rows (one transaction, an upsert). */
export function profanitySql(rows) {
  const values = rows
    .map((r) => `  (${lit(r.term)}, 'profanity', ${lit(r.mode)}, ${r.note ? lit(r.note) : 'null'})`)
    .join(',\n');
  return [
    'begin;',
    'insert into app.seduh_handle_blocklist (term, kind, match_mode, note) values',
    `${values}`,
    'on conflict (term, kind) do update set match_mode = excluded.match_mode, note = excluded.note;',
    "select kind, match_mode, count(*) from app.seduh_handle_blocklist where kind = 'profanity' group by 1, 2 order by 1, 2;",
    'commit;',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/seduh-handle-blocklist-sql.mjs <profanity.csv> > load.sql');
    process.exit(2);
  }
  try {
    process.stdout.write(profanitySql(parseProfanityCsv(readFileSync(file, 'utf8'))));
  } catch (e) {
    console.error(`${file}: ${e.message}`);
    process.exit(1);
  }
}

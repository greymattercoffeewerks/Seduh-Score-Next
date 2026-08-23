// Table spec -> CSV / PDF (handoff §6, §14 T4.8). Format-agnostic: builds a
// downloadable CSV from any `{ title, columns, rows }` table spec — nothing
// here knows about Cup Taster, stages, or heats. Any future format builds
// its own table specs and calls the same two functions.
//
// PDF export in this project is the browser's own Print -> Save as PDF
// against a print-optimized stylesheet, not a generated file — scoped with
// the user before writing code, matching this project's near-zero-
// dependency stack (this file adds no new dependency; a client-side PDF
// library would have been the first non-Supabase runtime dependency since
// Phase 0). There is deliberately no `buildPdf` here — a format that wants
// print support owns its own `@media print` rules, the same way it owns its
// own screen CSS.

function escapeCsvValue(value) {
  const str = value == null ? '' : String(value);
  // RFC 4180-ish CSV escaping: quote any value containing a comma, quote, or
  // newline, doubling internal quotes. Everything else is written as-is.
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Pure. One table -> one CSV block: a header row (from each column's
// `label`), then one row per data row (values pulled by each column's
// `key`) — `\r\n` line endings, matching CSV's own convention over `\n`
// alone.
export function buildCsv(table) {
  const header = table.columns.map((col) => escapeCsvValue(col.label)).join(',');
  const rows = table.rows.map((row) =>
    table.columns.map((col) => escapeCsvValue(row[col.key])).join(','),
  );
  return [header, ...rows].join('\r\n');
}

// Pure. Multiple tables -> one CSV file, each preceded by its own title line
// and separated by a blank line — a common enough multi-section CSV
// convention that spreadsheet apps open sensibly, and the only way to hand
// an organiser ONE file for a whole report rather than one download per
// table.
export function buildCsvForTables(tables) {
  return tables
    .map((table) => `${escapeCsvValue(table.title)}\r\n${buildCsv(table)}`)
    .join('\r\n\r\n');
}

// DOM. Triggers a browser download via a synthetic <a download> — the
// standard client-side "save this string as a file" pattern, no server
// round trip. Appended to the DOM before clicking (not strictly required by
// every current browser, but the safe, portable form of this pattern) and
// removed immediately after.
export function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

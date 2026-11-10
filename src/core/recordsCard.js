// "Records": download buttons for the files an event produces (the dispute-pack JSON, a scores CSV, ...). The
// format supplies a list of `{ label, filename, build }`; this draws one button per entry, with a busy state, a
// worded error and a retry, and saves the result through core/export.js. Format-agnostic: it knows neither what
// a record contains nor where it comes from.
//
// `build()` may be async (a database read) and returns the content:
//  - for a `.json` filename, any JSON-able value (saved pretty-printed by `downloadJson`);
//  - for a `.csv` filename, a CSV string, a table spec `{ title, columns, rows }`, or a list of table specs
//    (saved by `downloadCsv` after `buildCsv` / `buildCsvForTables`).
// A file name with any other extension is not offered (the entry is dropped, see `usableRecords`).
//
// Styled in components.css (`.ok-records*`).
import { el, setBusyDisabled } from './dom.js';
import { buildCsv, buildCsvForTables, downloadCsv, downloadJson } from './export.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from './timeout.js';

// Pure. 'json' | 'csv' for a file name, null for anything else.
export function recordKind(filename) {
  if (typeof filename !== 'string') return null;
  const match = /\.(json|csv)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : null;
}

// Pure. The entries a card can offer: a non-empty label, a file name of a known kind and a `build` function.
// Anything else is dropped (a half-filled entry must not become a dead button). A repeated file name keeps the
// first.
export function usableRecords(records) {
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  const out = [];
  for (const record of records) {
    if (!record || typeof record.build !== 'function') continue;
    if (typeof record.label !== 'string' || record.label.trim() === '') continue;
    if (recordKind(record.filename) === null) continue;
    if (seen.has(record.filename)) continue;
    seen.add(record.filename);
    out.push({ label: record.label.trim(), filename: record.filename.trim(), build: record.build });
  }
  return out;
}

// Pure. The text of a CSV `build()` result: a string as it is, a table spec or a list of them through
// core/export.js. Throws on anything else (the card reports it as a failure to prepare the file).
export function csvText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return buildCsvForTables(content);
  if (content && Array.isArray(content.columns) && Array.isArray(content.rows)) {
    return buildCsv(content);
  }
  throw new Error('unsupported csv content');
}

const DEFAULT_SAVE = (record, content) => {
  if (recordKind(record.filename) === 'csv') downloadCsv(record.filename, csvText(content));
  else downloadJson(record.filename, content);
};

/**
 * @param {{ label: string, filename: string, build: () => unknown }[]} records
 * @param {{
 *   heading?: string, intro?: string|null, timeoutMs?: number,
 *   save?: (record: object, content: unknown) => void
 * }} [options] `save` is injectable (a test need not touch the browser's download)
 * @returns {HTMLElement}
 */
export function buildRecordsCard(records, options = {}) {
  const {
    heading = 'Records',
    intro = null,
    timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
    save = DEFAULT_SAVE,
  } = options;
  const entries = usableRecords(records);

  // One polite status line for the whole card, kept in place (a live region that is replaced is not reliably
  // announced).
  const status = el('p', {
    className: 'ok-records-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const setStatus = (message, tone) => {
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  const rows = entries.map((record) => {
    const button = el('button', {
      className: 'btn btn-outline tap-target ok-records-button',
      attrs: { type: 'button' },
    });
    button.append(
      el('span', { className: 'ok-records-label', text: record.label }),
      el('span', { className: 'ok-records-file', text: record.filename }),
    );
    let busy = false;
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      setBusyDisabled(button, true);
      setStatus(`Preparing ${record.filename}…`);
      try {
        const content = await raceTimeout(Promise.resolve().then(record.build), timeoutMs);
        save(record, content);
        setStatus(`${record.filename} downloaded.`, 'success');
      } catch (error) {
        setStatus(
          error?.timedOut
            ? `Preparing ${record.filename} is taking too long. Check the connection and try again.`
            : `Could not prepare ${record.filename}. Try again.`,
          'error',
        );
      } finally {
        busy = false;
        setBusyDisabled(button, false);
      }
    });
    return el('li', { className: 'ok-records-item' }, [button]);
  });

  const body =
    entries.length === 0
      ? el('p', { className: 'ok-records-empty', text: 'No records to download yet.' })
      : el('ul', { className: 'ok-records-list', attrs: { role: 'list' } }, rows);

  return el(
    'section',
    { className: 'ok-card ok-records', attrs: { 'aria-labelledby': 'ok-records-heading' } },
    [
      el('h2', { className: 'ok-card-heading', id: 'ok-records-heading', text: heading }),
      ...(intro ? [el('p', { className: 'ok-card-intro', text: intro })] : []),
      body,
      status,
    ],
  );
}

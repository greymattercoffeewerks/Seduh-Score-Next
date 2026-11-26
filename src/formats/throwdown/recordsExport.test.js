import { describe, it, expect } from 'vitest';
import { MATCH_LOG_COLUMNS, matchLogCsv, matchLogFilename, matchLogRows } from './recordsExport.js';
import { bracketOf, entry, match } from './dashboardFixtures.js';
import { csvText } from '../../core/recordsCard.js';

// A minimal RFC 4180 reader, so the quoting is checked by reading the file back, not by comparing strings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (c === '\n' || c === '\r') {
      // strict: a line break outside quotes that is not CRLF is a malformed record, never cell content
      throw new Error('unquoted line break');
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

const entries = [
  entry(1, { display_name: 'Ana' }),
  entry(2, { display_name: 'Bo' }),
  entry(3, { display_name: 'Cy' }),
  entry(4, { display_name: 'Di' }),
];
const finished = bracketOf(entries, [
  {
    matches: [
      match(['e1', 'e2'], { result: 'votes', votes: [2, 1], at: '2026-11-27T10:05:00Z' }),
      match(['e3', null], { result: 'bye' }),
    ],
  },
  { matches: [match(['e1', 'e3'], { result: 'walkover', walkoverWinner: 2 })] },
  { phase: 'third_place', matches: [match(['e2', 'e4'])] },
]);

describe('matchLogCsv', () => {
  it('has a header and exactly one row per match, rounds in order', () => {
    const rows = parseCsv(matchLogCsv(finished));
    expect(rows[0]).toEqual([
      'Round',
      'Match',
      'Competitor A',
      'Competitor B',
      'Votes A',
      'Votes B',
      'Result',
      'Winner',
      'Confirmed at',
    ]);
    expect(rows).toHaveLength(1 + 4);
    expect(rows.slice(1).map((r) => r.slice(0, 2))).toEqual([
      ['Semi-finals', '1'],
      ['Semi-finals', '2'],
      ['Final', '1'],
      ['3rd place', '1'],
    ]);
  });

  it('words each kind of result and leaves what does not exist blank', () => {
    const [, vote, bye, walkover, open] = parseCsv(matchLogCsv(finished));
    expect(vote.slice(2, 8)).toEqual(['Ana', 'Bo', '2', '1', 'votes', 'Ana']);
    expect(vote[8]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // a bye has one competitor, no votes and that competitor as the winner
    expect(bye.slice(2, 8)).toEqual(['Cy', '', '', '', 'bye', 'Cy']);
    // a walkover is never a tally: the votes are blank, the winner is the recorded slot
    expect(walkover.slice(2, 8)).toEqual(['Ana', 'Cy', '', '', 'walkover', 'Cy']);
    // undecided: no result, no winner, no confirm time
    expect(open.slice(2)).toEqual(['Bo', 'Di', '0', '0', '', '', '']);
  });

  it('quotes commas, quotes and line breaks in names so the file reads back the same', () => {
    const names = ['Smith, Jo', 'Ann "AJ" Lee', 'Two\nLines', 'Tab\r\nCRLF'];
    const es = names.map((n, i) => entry(i + 1, { display_name: n }));
    const bracket = bracketOf(es, [{ matches: [match(['e1', 'e2']), match(['e3', 'e4'])] }]);
    const text = matchLogCsv(bracket);
    const rows = parseCsv(text);
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(2, 4)).toEqual(['Smith, Jo', 'Ann "AJ" Lee']);
    expect(rows[2].slice(2, 4)).toEqual(['Two\nLines', 'Tab CRLF']);
    expect(text).toContain('"Smith, Jo"');
    expect(text).toContain('"Ann ""AJ"" Lee"');
    expect(text).toContain('"Two\nLines"');
    expect(text.match(/\r(?!\n)/g)).toBeNull(); // no bare CR anywhere in the file
  });

  it('turns a bare carriage return in a name into a space (core/export.js does not quote it)', () => {
    const es = [entry(1, { display_name: 'Bare\rCR' }), entry(2, { display_name: 'Ok' })];
    const text = matchLogCsv(bracketOf(es, [{ matches: [match(['e1', 'e2'])] }]));
    expect(text.match(/\r(?!\n)/g)).toBeNull();
    expect(parseCsv(text)[1].slice(2, 4)).toEqual(['Bare CR', 'Ok']);
  });

  it.each(['=SUM(A1)', '@cmd', '+1 555', '-cmd', '\tx'])(
    'keeps a spreadsheet from running %j as a formula',
    (name) => {
      const es = [entry(1, { display_name: name }), entry(2, { display_name: 'Ok' })];
      const [, row] = parseCsv(matchLogCsv(bracketOf(es, [{ matches: [match(['e1', 'e2'])] }])));
      expect(row[2]).toBe(`'${name}`);
    },
  );

  it('is an empty log (header only) before the draw, and a table core/recordsCard accepts', () => {
    const empty = bracketOf(entries, []);
    expect(parseCsv(matchLogCsv(empty))).toHaveLength(1);
    expect(matchLogRows(empty)).toEqual([]);
    // the table spec path of core/recordsCard.js builds the same file as the string path
    const spec = { title: 'Matches', columns: MATCH_LOG_COLUMNS, rows: matchLogRows(finished) };
    expect(csvText(spec)).toBe(matchLogCsv(finished));
    expect(csvText(matchLogCsv(finished))).toBe(matchLogCsv(finished));
  });

  it('leaves scored matches without vote counts (scores are never in the log)', () => {
    const scored = bracketOf(entries, [{ matches: [match(['e1', 'e2'], { result: 'scores' })] }]);
    const [row] = matchLogRows(scored);
    expect(row.votesA).toBe('');
    expect(row.votesB).toBe('');
    expect(row.resultKind).toBe('scores');
  });
});

describe('matchLogFilename', () => {
  it('is the event slug, "matches" and the local date', () => {
    expect(matchLogFilename({ name: 'Throwdown Nov 2026!' }, new Date(2026, 10, 27, 15, 0))).toBe(
      'throwdown-nov-2026-matches-2026-11-27.csv',
    );
  });
  it('falls back to a generic slug', () => {
    expect(matchLogFilename({ name: '' }, new Date(2027, 0, 9))).toBe(
      'throwdown-event-matches-2027-01-09.csv',
    );
    expect(matchLogFilename(null, new Date(2027, 0, 9))).toBe(
      'throwdown-event-matches-2027-01-09.csv',
    );
  });
});

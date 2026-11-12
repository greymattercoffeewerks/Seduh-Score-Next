import { describe, it, expect } from 'vitest';
import { buildSignOff, formatGeneratedAt, renderSignOffSheet } from './signOffSheet.js';

// Two fixtures from two formats, to prove the sheet is not BTC-shaped.
const btcSpec = () => ({
  title: 'Top 8 sign-off',
  eventName: 'ABTC Preliminaries',
  dateText: 'Event date 2027-03-20',
  event: { is_test: false, is_shadow: true },
  status: { kind: 'final', text: 'The 8 teams below go through to the knockout.' },
  qualifiers: {
    heading: 'The 8 going through, in seed order',
    columns: [
      { key: 'seed', header: 'Seed', numeric: true, cell: (row) => String(row.seed) },
      { key: 'team', header: 'Team', cell: (row) => row.name },
      { key: 'pts', header: 'Total', numeric: true, cell: (row) => row.pts },
    ],
    rows: [
      { seed: 1, name: 'Kopi', pts: 90 },
      { seed: 2, name: 'Teh', pts: 80 },
    ],
  },
  notes: {
    heading: 'Ties settled',
    emptyText: 'No teams were level on points.',
    items: [
      { title: 'Level for 8th to 9th · 60 pts', text: 'Order: Teh, then Kopi. Reason: cup-off' },
    ],
  },
  others: { heading: 'Not going through', items: ['9. Mocha · 55 pts', '10. Latte · 40 pts'] },
  signatories: [{ role: 'Committee chair' }, { role: 'Organiser' }],
  generatedAt: new Date(2026, 10, 10, 14, 5),
});
const cupTasterSpec = () => ({
  title: 'Advancement sign-off',
  eventName: 'Cup Taster Heat 3',
  status: { kind: 'final', text: 'Three cuppers advance.' },
  qualifiers: {
    heading: 'Advancing',
    columns: [{ key: 'name', header: 'Cupper', cell: (row) => row.name }],
    rows: [{ name: 'Ana' }, { name: 'Bo' }, { name: 'Cy' }],
  },
  signatories: [{ role: 'Head judge' }],
});

describe('formatGeneratedAt', () => {
  it('writes the local date and time to the minute', () => {
    expect(formatGeneratedAt(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04');
  });
  it('writes nothing for anything that is not a real date', () => {
    expect(formatGeneratedAt(null)).toBe('');
    expect(formatGeneratedAt(new Date('nope'))).toBe('');
    expect(formatGeneratedAt('2026-01-01')).toBe('');
  });
});

describe('buildSignOff', () => {
  it('keeps a final status only when asked, and treats anything else as a draft', () => {
    expect(buildSignOff({ status: { kind: 'final', text: 'x' } }).status.kind).toBe('final');
    expect(buildSignOff({ status: { kind: 'maybe', text: 'x' } }).status.kind).toBe('draft');
    expect(buildSignOff({}).status.kind).toBe('draft');
  });
  it('gives every list a safe default and drops empty entries', () => {
    const model = buildSignOff({
      notes: { heading: 'n', items: [{ text: '  ' }, { text: 'kept' }, null] },
      others: { heading: 'o', items: ['', 'kept'] },
      signatories: [{ role: ' ' }, { role: 'Chair' }],
    });
    expect(model.qualifiers.rows).toEqual([]);
    expect(model.notes.items).toHaveLength(1);
    expect(model.others.items).toEqual(['kept']);
    expect(model.signatories).toEqual([{ role: 'Chair' }]);
  });
});

describe('renderSignOffSheet', () => {
  const text = (node) => node.textContent.replace(/\s+/g, ' ');

  it('prints the title, event, date, status, the rows in the order given and the columns', () => {
    const sheet = renderSignOffSheet(btcSpec());
    expect(sheet.querySelector('.ok-signoff-title').textContent).toBe('Top 8 sign-off');
    expect(sheet.querySelector('.ok-signoff-event').textContent).toBe('ABTC Preliminaries');
    expect(sheet.querySelector('.ok-signoff-date').textContent).toBe('Event date 2027-03-20');
    expect(sheet.querySelector('.ok-signoff-status').getAttribute('data-status')).toBe('final');
    expect([...sheet.querySelectorAll('.ok-signoff-table th')].map((th) => th.textContent)).toEqual(
      ['Seed', 'Team', 'Total'],
    );
    const body = [...sheet.querySelectorAll('.ok-signoff-table tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(body).toEqual([
      ['1', 'Kopi', '90'],
      ['2', 'Teh', '80'],
    ]);
  });

  it('shows the beta band for a shadow run, the test band for test data, and none for a plain event', () => {
    expect(renderSignOffSheet(btcSpec()).querySelector('.ok-beta-band')).not.toBeNull();
    const test = { ...btcSpec(), event: { is_test: true } };
    expect(renderSignOffSheet(test).querySelector('.is-test-banner')).not.toBeNull();
    const plain = { ...btcSpec(), event: { is_test: false } };
    expect(renderSignOffSheet(plain).querySelector('.ok-beta-band, .is-test-banner')).toBeNull();
  });

  it('lists every settled tie with its reason in the notes box', () => {
    const sheet = renderSignOffSheet(btcSpec());
    expect(sheet.querySelector('.ok-signoff-box h3').textContent).toBe('Ties settled');
    expect(text(sheet.querySelector('.ok-signoff-notes'))).toBe(
      'Level for 8th to 9th · 60 pts: Order: Teh, then Kopi. Reason: cup-off',
    );
  });

  it('says there were no ties when there are none, rather than leave the box empty', () => {
    const spec = btcSpec();
    spec.notes.items = [];
    const sheet = renderSignOffSheet(spec);
    expect(sheet.querySelector('.ok-signoff-none').textContent).toBe(
      'No teams were level on points.',
    );
  });

  it('lists the ones not going through, in order, and omits the section when there are none', () => {
    const sheet = renderSignOffSheet(btcSpec());
    expect(
      [...sheet.querySelectorAll('.ok-signoff-others li')].map((li) => li.textContent),
    ).toEqual(['9. Mocha · 55 pts', '10. Latte · 40 pts']);
    const spec = btcSpec();
    spec.others.items = [];
    expect(renderSignOffSheet(spec).querySelector('.ok-signoff-others')).toBeNull();
  });

  it('gives each signatory a name line and a signature-and-date line', () => {
    const sheet = renderSignOffSheet(btcSpec());
    const blocks = [...sheet.querySelectorAll('.ok-signoff-signature')];
    expect(blocks.map((b) => b.querySelector('.ok-signoff-role').textContent)).toEqual([
      'Committee chair',
      'Organiser',
    ]);
    for (const block of blocks) {
      expect([...block.querySelectorAll('.ok-signoff-line')].map((l) => l.textContent)).toEqual([
        'Name',
        'Signature and date',
      ]);
    }
  });

  it('prints when it was generated', () => {
    expect(renderSignOffSheet(btcSpec()).querySelector('.ok-signoff-generated').textContent).toBe(
      'Generated by Seduh Score on 2026-11-10 14:05',
    );
  });

  it('says NOT FINAL unmistakably for a draft', () => {
    const spec = btcSpec();
    spec.status = { kind: 'draft', text: 'NOT FINAL. Round 2 still has 3 matches to confirm.' };
    const status = renderSignOffSheet(spec).querySelector('.ok-signoff-status');
    expect(status.getAttribute('data-status')).toBe('draft');
    expect(status.textContent).toContain('NOT FINAL');
  });

  it('writes text as text, never markup', () => {
    const spec = btcSpec();
    spec.eventName = '<img src=x onerror=alert(1)>';
    spec.others.items = ['<b>bold</b>'];
    const sheet = renderSignOffSheet(spec);
    expect(sheet.querySelector('img')).toBeNull();
    expect(sheet.querySelector('.ok-signoff-others b')).toBeNull();
    expect(sheet.querySelector('.ok-signoff-event').textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('prints a second format with no notes, no others and one signatory', () => {
    const sheet = renderSignOffSheet(cupTasterSpec());
    expect(sheet.querySelector('.ok-signoff-title').textContent).toBe('Advancement sign-off');
    expect(sheet.querySelectorAll('.ok-signoff-table tbody tr')).toHaveLength(3);
    expect(sheet.querySelector('.ok-signoff-box')).toBeNull();
    expect(sheet.querySelector('.ok-signoff-others')).toBeNull();
    expect(sheet.querySelectorAll('.ok-signoff-signature')).toHaveLength(1);
    expect(sheet.querySelector('.ok-signoff-generated')).toBeNull();
  });
});

describe('a draft with no words', () => {
  it('still says NOT FINAL', () => {
    const spec = cupTasterSpec();
    spec.status = { kind: 'draft', text: '' };
    expect(renderSignOffSheet(spec).querySelector('.ok-signoff-status').textContent).toBe(
      'NOT FINAL',
    );
  });
});

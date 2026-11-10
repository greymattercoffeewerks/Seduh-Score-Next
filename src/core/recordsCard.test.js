import { describe, it, expect, vi } from 'vitest';
import { recordKind, usableRecords, csvText, buildRecordsCard } from './recordsCard.js';

// Records as two different formats would supply them.
const btcRecords = () => [
  {
    label: 'Download the record (JSON)',
    filename: 'abtc-record.json',
    build: async () => ({ matches: [1, 2] }),
  },
  {
    label: 'Download scores (CSV)',
    filename: 'abtc-scores.csv',
    build: async () => ({
      title: 'Scores',
      columns: [
        { key: 'match', label: 'Match' },
        { key: 'cup', label: 'Cup' },
      ],
      rows: [{ match: 1, cup: 'A, B' }],
    }),
  },
];
const cupTasterRecords = () => [
  { label: 'Dispute pack', filename: 'cup-taster-dispute-pack.json', build: () => ({ heats: [] }) },
  { label: 'Heat results', filename: 'cup-taster-heats.csv', build: () => 'heat,score\r\n1,9' },
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const clickAndSettle = async (button) => {
  button.click();
  await settle();
  await settle();
};

describe('recordKind / usableRecords', () => {
  it('knows json and csv by extension, case-insensitively, and nothing else', () => {
    expect(recordKind('a.json')).toBe('json');
    expect(recordKind('A.CSV')).toBe('csv');
    expect(recordKind('a.pdf')).toBeNull();
    expect(recordKind('json')).toBeNull();
    expect(recordKind(null)).toBeNull();
  });

  it('drops half-filled entries (a dead button is worse than none) and repeated file names', () => {
    const good = btcRecords()[0];
    const out = usableRecords([
      good,
      { ...good },
      { label: '', filename: 'a.json', build: () => 1 },
      { label: 'No build', filename: 'b.json' },
      { label: 'Bad type', filename: 'c.pdf', build: () => 1 },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].filename).toBe('abtc-record.json');
    expect(usableRecords(undefined)).toEqual([]);
  });
});

describe('csvText', () => {
  it('passes a string, builds one table, builds several, and refuses anything else', () => {
    expect(csvText('a,b')).toBe('a,b');
    const table = { title: 'T', columns: [{ key: 'x', label: 'X' }], rows: [{ x: '1,2' }] };
    expect(csvText(table)).toBe('X\r\n"1,2"');
    expect(csvText([table, table])).toBe('T\r\nX\r\n"1,2"\r\n\r\nT\r\nX\r\n"1,2"');
    expect(() => csvText(42)).toThrow();
    expect(() => csvText(null)).toThrow();
  });
});

describe('buildRecordsCard', () => {
  it('draws one button per record with its label and file name, for either format', () => {
    for (const records of [btcRecords(), cupTasterRecords()]) {
      const card = buildRecordsCard(records);
      const buttons = [...card.querySelectorAll('button')];
      expect(buttons).toHaveLength(2);
      expect(buttons.map((b) => b.querySelector('.ok-records-file').textContent)).toEqual(
        records.map((r) => r.filename),
      );
      expect(card.querySelector('h2').textContent).toBe('Records');
    }
  });

  it('says so when there is nothing to download', () => {
    const card = buildRecordsCard([]);
    expect(card.querySelectorAll('button')).toHaveLength(0);
    expect(card.querySelector('.ok-records-empty').textContent).toBe('No records to download yet.');
  });

  it('builds on click, saves what build() returned, and says it downloaded', async () => {
    const save = vi.fn();
    const card = buildRecordsCard(btcRecords(), { save });
    await clickAndSettle(card.querySelectorAll('button')[0]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].filename).toBe('abtc-record.json');
    expect(save.mock.calls[0][1]).toEqual({ matches: [1, 2] });
    const status = card.querySelector('.ok-records-status');
    expect(status.textContent).toBe('abtc-record.json downloaded.');
    expect(status.dataset.tone).toBe('success');
    expect(status.getAttribute('role')).toBe('status');
  });

  it('is busy while building: aria-busy and aria-disabled, a second click does nothing, then it recovers', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const build = vi.fn(() => gate);
    const save = vi.fn();
    const card = buildRecordsCard([{ label: 'L', filename: 'a.json', build }], { save });
    const button = card.querySelector('button');
    button.click();
    await settle();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(card.querySelector('.ok-records-status').textContent).toBe('Preparing a.json…');
    // Not natively disabled: focus must not drop to the page.
    expect(button.disabled).toBe(false);
    button.click();
    await settle();
    expect(build).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await settle();
    await settle();
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('shows a worded error when build fails, keeps the button, and a retry can succeed', async () => {
    let attempt = 0;
    const save = vi.fn();
    const card = buildRecordsCard(
      [
        {
          label: 'L',
          filename: 'a.csv',
          build: async () => {
            attempt += 1;
            if (attempt === 1) throw new Error('rpc failed');
            return 'x,y';
          },
        },
      ],
      { save },
    );
    const button = card.querySelector('button');
    await clickAndSettle(button);
    const status = card.querySelector('.ok-records-status');
    expect(status.textContent).toBe('Could not prepare a.csv. Try again.');
    expect(status.dataset.tone).toBe('error');
    expect(save).not.toHaveBeenCalled();
    expect(button.hasAttribute('aria-busy')).toBe(false);
    await clickAndSettle(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect(status.textContent).toBe('a.csv downloaded.');
    expect(status.dataset.tone).toBe('success');
  });

  it('reports a build that never answers as taking too long, not as a silent hang', async () => {
    const card = buildRecordsCard(
      [{ label: 'L', filename: 'a.json', build: () => new Promise(() => {}) }],
      { timeoutMs: 5, save: vi.fn() },
    );
    await clickAndSettle(card.querySelector('button'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(card.querySelector('.ok-records-status').textContent).toMatch(/taking too long/);
  });

  it('reports a save that throws (an unsupported CSV shape) as a failure to prepare', async () => {
    const card = buildRecordsCard([{ label: 'L', filename: 'a.csv', build: () => 42 }]);
    await clickAndSettle(card.querySelector('button'));
    expect(card.querySelector('.ok-records-status').textContent).toBe(
      'Could not prepare a.csv. Try again.',
    );
  });

  it('saves through core/export.js by default: a Blob download link for the right file name', async () => {
    const created = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => {
      created.push(blob);
      return 'blob:fake';
    };
    URL.revokeObjectURL = () => {};
    const names = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      names.push(this.download);
    });
    try {
      const card = buildRecordsCard(cupTasterRecords());
      for (const button of card.querySelectorAll('button')) await clickAndSettle(button);
      expect(names).toEqual(['cup-taster-dispute-pack.json', 'cup-taster-heats.csv']);
      expect(created.map((blob) => blob.type)).toEqual([
        'application/json;charset=utf-8;',
        'text/csv;charset=utf-8;',
      ]);
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

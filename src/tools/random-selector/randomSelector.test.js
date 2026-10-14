import { describe, expect, it, vi } from 'vitest';
import {
  browserStorage,
  checkEntries,
  describeEntryProblems,
  insertDraftLine,
  removeDraftLine,
  replaceDraftLine,
  contrastRatio,
  decodeShare,
  encodeShare,
  entriesFromCsv,
  entriesToCsv,
  formatEntries,
  loadSaved,
  MAX_ENTRIES,
  parseCsv,
  parseEntries,
  readableOn,
  saveCurrent,
  validAccentColor,
  validBoardTitle,
  validDrawPreset,
  validSoundLevel,
  weightedIndex,
} from './randomSelector.js';

describe('random selector entries', () => {
  it('parses explicit integer weights and bounds malformed values safely', () => {
    expect(parseEntries('Amir | 2\nBella | 0\nChin | 1001\n\nDina')).toEqual([
      { name: 'Amir', weight: 2 },
      { name: 'Bella', weight: 1 },
      { name: 'Chin', weight: 1000 },
      { name: 'Dina', weight: 1 },
    ]);
  });

  it('formats weight one without extra syntax', () => {
    expect(
      formatEntries([
        { name: 'Amir', weight: 1 },
        { name: 'Bella', weight: 3 },
      ]),
    ).toBe('Amir\nBella | 3');
  });
});

describe('random selector draw', () => {
  it('maps secure random values across weighted entries', () => {
    const random = (values) => {
      values[0] = 1;
    };
    expect(
      weightedIndex(
        [
          { name: 'Amir', weight: 1 },
          { name: 'Bella', weight: 2 },
        ],
        random,
      ),
    ).toBe(1);
  });

  it('rejects values in the modulo-biased tail before selecting', () => {
    const values = [0xffff_ffff, 0];
    const random = (target) => {
      target[0] = values.shift();
    };
    expect(
      weightedIndex(
        [
          { name: 'Amir', weight: 1 },
          { name: 'Bella', weight: 2 },
        ],
        random,
      ),
    ).toBe(0);
  });
});

describe('random selector share links', () => {
  it('round-trips a draw list, removal setting and draw settings', () => {
    const draw = {
      draft: 'Amir | 2\nBella',
      removeAfterDraw: true,
      drawPreset: 'ceremonial',
      soundLevel: 0.4,
      boardTitle: 'Friday Finals',
      accentColor: '#d96135',
    };
    expect(decodeShare(encodeShare(draw))).toEqual(draw);
  });

  it('rejects invalid shared data', () => {
    expect(decodeShare('not-a-share-link')).toBeNull();
  });
});

describe('random selector draw settings', () => {
  it('uses safe settings when a saved or shared value is invalid', () => {
    expect(validDrawPreset('unknown')).toBe('standard');
    expect(validSoundLevel(9)).toBe(1);
    expect(validSoundLevel(0)).toBe(0.1);
    expect(validBoardTitle('  Friday   Finals  ')).toBe('Friday Finals');
    expect(validBoardTitle('')).toBe('PLAYER DRAW');
    expect(validAccentColor('#D96135')).toBe('#d96135');
    // No custom accent is null (the Petrol token); the old built-in default means the same thing.
    expect(validAccentColor('orange')).toBeNull();
    expect(validAccentColor(undefined)).toBeNull();
    expect(validAccentColor('#0FB5A3')).toBeNull();
  });
});

describe('random selector csv', () => {
  it('keeps commas, doubled quotes and line breaks inside quoted cells', () => {
    expect(parseCsv('"Smith, John",3\r\n"Say ""hi""",1\n"two\nlines"')).toEqual([
      ['Smith, John', '3'],
      ['Say "hi"', '1'],
      ['two\nlines'],
    ]);
  });

  it('accepts a byte-order mark, a header row, a blank line and a missing final newline', () => {
    const { entries, total } = entriesFromCsv('\uFEFFEntry,Weight\r\nAmir,2\r\n\r\nBella');
    expect(entries).toEqual([
      { name: 'Amir', weight: 2 },
      { name: 'Bella', weight: 1 },
    ]);
    expect(total).toBe(2);
  });

  it('reads the weight column and bounds bad weights the same way the list does', () => {
    const { entries } = entriesFromCsv('Amir,0\nBella,5000\nChin,abc\nDina,2.6');
    expect(entries.map((entry) => entry.weight)).toEqual([1, 1000, 1, 3]);
  });

  it('round-trips an export, including names with commas and quotes', () => {
    const entries = [
      { name: 'Smith, John', weight: 3 },
      { name: 'Say "hi"', weight: 1 },
      { name: 'Nur Aisyah', weight: 1000 },
    ];
    expect(entriesFromCsv(entriesToCsv(entries)).entries).toEqual(entries);
  });

  it('reports how many entries the file held when the limit cuts some', () => {
    const file = Array.from({ length: MAX_ENTRIES + 7 }, (_, index) => `Name ${index}`).join('\n');
    const { entries, total } = entriesFromCsv(file);
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(total).toBe(MAX_ENTRIES + 7);
  });

  it('finds nothing in an empty or header-only file', () => {
    expect(entriesFromCsv('').entries).toEqual([]);
    expect(entriesFromCsv('Entry,Weight\r\n').entries).toEqual([]);
  });
});

describe('random selector accent colour', () => {
  it('picks text that clears WCAG AA on a 512-colour sample of accents (the proof is the luminance argument in readableOn)', () => {
    const channels = [0x00, 0x40, 0x7f, 0x80, 0xa0, 0xc0, 0xe0, 0xff];
    for (const red of channels) {
      for (const green of channels) {
        for (const blue of channels) {
          const color = `#${[red, green, blue].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          expect(contrastRatio(color, readableOn(color)), color).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('chooses dark text on yellow and white text on navy', () => {
    expect(readableOn('#ffff00')).toBe('#000000');
    expect(readableOn('#001f5b')).toBe('#ffffff');
  });
});

describe('random selector round trips and hostile input', () => {
  it('writes a name that ends in "| 5" with its own weight so it is not read as a weight', () => {
    const entries = [
      { name: 'Room | 5', weight: 1 },
      { name: 'Hall | 2', weight: 3 },
    ];
    expect(parseEntries(formatEntries(entries))).toEqual(entries);
  });

  it('keeps an imported name on one line and the weight column intact', () => {
    const { entries } = entriesFromCsv('"Room | 5",1\r\n"two\r\nlines",2');
    expect(entries).toEqual([
      { name: 'Room | 5', weight: 1 },
      { name: 'two lines', weight: 2 },
    ]);
    expect(parseEntries(formatEntries(entries))).toEqual(entries);
  });

  it('exports formula-looking names so a spreadsheet will not run them, and imports them back exact', () => {
    const entries = [
      { name: '=HYPERLINK("http://x")', weight: 1 },
      { name: '+1', weight: 2 },
      { name: '-Amir', weight: 1 },
      { name: '@home', weight: 1 },
      { name: "'=already quoted", weight: 1 },
      { name: 'Normal', weight: 1 },
    ];
    const csv = entriesToCsv(entries);
    for (const line of csv.split('\r\n').slice(1)) {
      expect(line, line).not.toMatch(/^"?[=+\-@]/);
    }
    expect(entriesFromCsv(csv).entries).toEqual(entries);
  });

  it('drops saved history records that are not draw records instead of crashing later', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          draft: 'A',
          history: [null, 3, 'x', { name: 'Zed', removed: false }, { removed: true }],
        }),
    };
    expect(loadSaved(storage).history).toEqual([{ name: 'Zed', removed: false }]);
  });

  it('stores only a real preset key, never a coerced array or object', () => {
    expect(validDrawPreset(['quick'])).toBe('quick');
    expect(typeof validDrawPreset(['quick'])).toBe('string');
    expect(validDrawPreset({})).toBe('standard');
  });

  it('reads blocked browser storage as null instead of throwing', () => {
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      blocked.mockRestore();
    }
  });
});

describe('random selector weighted draw (pinned with chosen random values)', () => {
  const pick = (entries, value) =>
    weightedIndex(entries, (values) => {
      values[0] = value;
    });
  const named = (...weights) => weights.map((weight, index) => ({ name: `E${index}`, weight }));

  it('gives each entry as many slots as its weight', () => {
    const counts = [0, 0, 0];
    for (let value = 0; value < 6; value += 1) counts[pick(named(1, 2, 3), value)] += 1;
    expect(counts).toEqual([1, 2, 3]);
    // A uniform pick would give [0, 1, 0, 1] here.
    expect([0, 1, 2, 3].map((value) => pick(named(1, 2), value))).toEqual([0, 1, 1, 0]);
  });

  it('throws away values from the biased tail instead of folding them into the first entries', () => {
    // Total weight 1000: the largest multiple of 1000 below 2^32 is 4294967000, so 4294967100 is in
    // the tail. Taken modulo 1000 it would land on slot 100, which belongs to the third entry.
    const values = [4_294_967_100, 0];
    const draw = weightedIndex(named(50, 50, 900), (target) => {
      target[0] = values.shift();
    });
    expect(draw).toBe(0);
    expect(values).toEqual([]);
  });
});

describe('random selector limits, share codec and saved state', () => {
  it('caps the list and the board title', () => {
    expect(
      parseEntries(Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => `N${i}`).join('\n')),
    ).toHaveLength(MAX_ENTRIES);
    expect(validBoardTitle('x'.repeat(40))).toHaveLength(32);
  });

  it('round-trips non-ASCII names and rejects shapes it did not write', () => {
    const draw = { draft: 'Zoë 2\nNur Aisyah', removeAfterDraw: false };
    expect(decodeShare(encodeShare(draw)).draft).toBe('Zoë 2\nNur Aisyah');
    expect(decodeShare(encodeShare({ draft: 'A', removeAfterDraw: 'yes' }))).toBeNull();
    expect(decodeShare('a'.repeat(12_001))).toBeNull();
    expect(decodeShare(null)).toBeNull();
  });

  it('computes contrast the way WCAG defines it, against known answers', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(4, 1);
    expect(contrastRatio('#00ff00', '#ffffff')).toBeCloseTo(1.37, 2);
  });

  it('loads saved state with safe defaults and keeps only the last 20 draws', () => {
    const history = Array.from({ length: 25 }, (_, n) => ({ name: `P${n}` }));
    const storage = { getItem: () => JSON.stringify({ draft: 'A', removeAfterDraw: 1, history }) };
    const loaded = loadSaved(storage);
    expect(loaded.soundOn).toBe(true);
    expect(loaded.removeAfterDraw).toBe(true);
    expect(loaded.history).toHaveLength(20);
    expect(loaded.history[19].name).toBe('P24');
    expect(loadSaved({ getItem: () => 'not json' })).toBeNull();
    expect(loadSaved(null)).toBeNull();
  });

  it('writes the state it loads back, and survives storage that throws', () => {
    const written = [];
    const state = { draft: 'A', history: [], soundOn: false };
    saveCurrent(state, { setItem: (key, value) => written.push(JSON.parse(value)) });
    expect(written[0].draft).toBe('A');
    expect(written[0].soundOn).toBe(false);
    expect(() =>
      saveCurrent(state, {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
  });
});

describe('random selector says what it changed or left out', () => {
  const lines = (count) => Array.from({ length: count }, (_, i) => `N${i}`).join('\n');

  it('counts entries past the limit and the weights it had to change, and nothing else', () => {
    const report = checkEntries(`${lines(MAX_ENTRIES + 3)}\n\n`);
    expect(report.entries).toHaveLength(MAX_ENTRIES);
    expect(report.ignored).toBe(3);
    expect(report.adjusted).toEqual([]);
    expect(report.entries[0].name).toBe('N0');
    expect(report.entries.at(-1).name).toBe(`N${MAX_ENTRIES - 1}`);

    const weights = checkEntries('A | 0\nB | 1500\nC | 2.6\nD | 2.0\nE | 7\nF');
    expect(weights.adjusted).toEqual([
      { name: 'A', written: '0', weight: 1 },
      { name: 'B', written: '1500', weight: 1000 },
      { name: 'C', written: '2.6', weight: 3 },
    ]);
    expect(weights.ignored).toBe(0);
  });

  it('reports a negative weight instead of reading it as part of the name', () => {
    const report = checkEntries('A | -3\nB | abc');
    expect(report.entries).toEqual([
      { name: 'A', weight: 1 },
      { name: 'B | abc', weight: 1 },
    ]);
    expect(report.adjusted).toEqual([{ name: 'A', written: '-3', weight: 1 }]);
  });

  it('keeps a line with a Unicode line separator in its name, and counts a nameless line', () => {
    const report = checkEntries('A\nB\u2028C | 2\n| 3\n  | 7\nD');
    expect(report.entries.map((entry) => entry.name)).toEqual(['A', 'B\u2028C', 'D']);
    expect(report.entries[1].weight).toBe(2);
    expect(report.nameless).toBe(2);
    expect(describeEntryProblems(report)).toBe(
      '2 lines have a weight but no name and are skipped.',
    );
    expect(describeEntryProblems(checkEntries('| 3'))).toBe(
      '1 line has a weight but no name and is skipped.',
    );
  });

  it('describes the findings in plain words, and is silent when there are none', () => {
    expect(describeEntryProblems({ ignored: 0, nameless: 0, adjusted: [] })).toBe('');
    expect(describeEntryProblems({ ignored: 1, adjusted: [] })).toBe(
      `1 line is past the ${MAX_ENTRIES}-entry limit and ignored.`,
    );
    expect(describeEntryProblems({ ignored: 5, adjusted: [] })).toContain('5 lines are past');
    const text = describeEntryProblems(checkEntries('A | 0\nB | 1500\nC | 2.6\nD | 0\nE | 0'));
    expect(text).toBe(
      'Weights run from 1 to 1000. Changed: “A” (0 → 1), “B” (1500 → 1000), “C” (2.6 → 3), and 2 more.',
    );
  });
});

describe('random selector edits one line of the typed list and leaves the rest as typed', () => {
  const draft = 'Amir\n\nBella | 2\nChin';

  it('replaces, removes and inserts by the position of the entry line', () => {
    expect(replaceDraftLine(draft, 1, { name: 'Bella', weight: 5 })).toBe(
      'Amir\n\nBella | 5\nChin',
    );
    expect(removeDraftLine(draft, 1)).toBe('Amir\n\nChin');
    expect(insertDraftLine(draft, 1, { name: 'Zed', weight: 1 })).toBe(
      'Amir\n\nZed\nBella | 2\nChin',
    );
  });

  it('inserts at the end, into an empty list, and ignores a position that is not there', () => {
    expect(insertDraftLine(draft, 3, { name: 'Zed', weight: 1 })).toBe(
      'Amir\n\nBella | 2\nChin\nZed',
    );
    expect(insertDraftLine('', 0, { name: 'Zed', weight: 3 })).toBe('Zed | 3');
    expect(replaceDraftLine(draft, 9, { name: 'X', weight: 1 })).toBe(draft);
    expect(removeDraftLine(draft, 9)).toBe(draft);
  });

  it('counts entry lines the way checkEntries does, so a nameless line is never the one edited', () => {
    const odd = '| 5\nAmir\n| 7\nBella';
    expect(replaceDraftLine(odd, 0, { name: 'Amir', weight: 2 })).toBe('| 5\nAmir | 2\n| 7\nBella');
    expect(removeDraftLine(odd, 1)).toBe('| 5\nAmir\n| 7');
    expect(insertDraftLine(odd, 1, { name: 'Zed', weight: 1 })).toBe('| 5\nAmir\n| 7\nZed\nBella');
    // Every position checkEntries reports is the line that gets edited.
    const names = checkEntries(odd).entries.map((entry) => entry.name);
    names.forEach((name, index) => {
      expect(removeDraftLine(odd, index).split('\n')).not.toContain(name);
    });
  });

  it('keeps blank lines when the list has no entry in it', () => {
    expect(insertDraftLine('\n\n', 0, { name: 'Zed', weight: 1 })).toBe('Zed\n\n');
    expect(insertDraftLine('| 3', 0, { name: 'Zed', weight: 1 })).toBe('| 3\nZed');
  });

  it('keeps entries past the limit when a middle line is removed', () => {
    const long = Array.from({ length: MAX_ENTRIES + 2 }, (_, i) => `N${i}`).join('\n');
    const after = removeDraftLine(long, 0);
    expect(checkEntries(after).entries[0].name).toBe('N1');
    expect(checkEntries(after).ignored).toBe(1);
    expect(after.split('\n')).toHaveLength(MAX_ENTRIES + 1);
  });
});

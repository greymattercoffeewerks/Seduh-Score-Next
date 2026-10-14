import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  decodeShare,
  encodeShare,
  entriesFromCsv,
  entriesToCsv,
  formatEntries,
  MAX_ENTRIES,
  parseCsv,
  parseEntries,
  readableOn,
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
    expect(validAccentColor('orange')).toBe('#0fb5a3');
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
  it('always picks text that clears WCAG AA on whatever accent the user chooses', () => {
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

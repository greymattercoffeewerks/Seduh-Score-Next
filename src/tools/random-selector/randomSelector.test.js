import { describe, expect, it } from 'vitest';
import {
  decodeShare,
  encodeShare,
  formatEntries,
  parseEntries,
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

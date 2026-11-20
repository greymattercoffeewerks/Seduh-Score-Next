import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Scores are console-only. The files that draw or assemble anything public must never import the files that read sheets.
const PUBLIC = ['liveSession.js', 'viewerBody.js', 'projectorScreens.js', 'projectorBody.js'];
const CONSOLE_ONLY = ['scoredMatch.js', 'scoreEntry.js', 'scoreAudit.js', 'core/scoresheet.js'];

describe('scores never reach a public surface', () => {
  for (const file of PUBLIC) {
    it(`${file} imports nothing that reads a sheet`, () => {
      const source = readFileSync(join(import.meta.dirname, file), 'utf8');
      for (const banned of CONSOLE_ONLY) expect(source).not.toContain(banned);
      expect(source).not.toMatch(/td_score_|scoreSheets|scoreDecisions/);
    });
  }
  it('the live payload builder never reads the sheet rows', () => {
    const source = readFileSync(join(import.meta.dirname, 'liveSession.js'), 'utf8');
    expect(source).not.toMatch(/sheetsBySlot|grandTotal|decideScored/);
  });
});

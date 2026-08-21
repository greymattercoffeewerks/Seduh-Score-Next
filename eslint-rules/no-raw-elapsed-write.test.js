import { Linter } from 'eslint';
import { describe, it, expect } from 'vitest';
import rule from './no-raw-elapsed-write.js';

// Handoff §14 T2.5 AC: prove no-raw-elapsed-write fires on a direct assignment
// bypassing clampElapsed() — a permanent, CI-enforced proof, not a one-off
// manual check.
const linter = new Linter();
const config = {
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
  plugins: { local: { rules: { 'no-raw-elapsed-write': rule } } },
  rules: { 'local/no-raw-elapsed-write': 'error' },
};

function lint(code) {
  return linter.verify(code, config);
}

describe('no-raw-elapsed-write', () => {
  it('flags a direct object-literal assignment bypassing clampElapsed()', () => {
    const messages = lint('const payload = { elapsed_secs: secs };');
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatch(/elapsed_secs must come from clampElapsed\(\)/);
  });

  it('flags a direct member-expression assignment bypassing clampElapsed()', () => {
    const messages = lint('entry.elapsed_secs = rawSeconds;');
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toMatch(/elapsed_secs must come from clampElapsed\(\)/);
  });

  it('flags a literal assignment bypassing clampElapsed()', () => {
    const messages = lint('const payload = { elapsed_secs: 480 };');
    expect(messages).toHaveLength(1);
  });

  it("allows elapsed_secs read directly off clampElapsed()'s result", () => {
    const messages = lint('const payload = { elapsed_secs: clampElapsed(secs, dur).elapsed };');
    expect(messages).toHaveLength(0);
  });

  it('allows elapsed_secs assigned from a clampElapsed() member read', () => {
    const messages = lint('entry.elapsed_secs = clampElapsed(secs, dur).elapsed;');
    expect(messages).toHaveLength(0);
  });

  it("allows elapsed_secs read off a variable holding clampElapsed()'s result", () => {
    const messages = lint(
      'const clamped = clampElapsed(secs, dur); const payload = { elapsed_secs: clamped.elapsed };',
    );
    expect(messages).toHaveLength(0);
  });
});

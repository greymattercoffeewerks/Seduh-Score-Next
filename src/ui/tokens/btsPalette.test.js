import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// public/bts/index.html is a standalone static page and cannot link the built token files, so it carries a copy
// of the palette and motion tokens. This keeps the copy from drifting from the real tokens.
const read = (p) => readFileSync(p, 'utf8');
const declared = (css, name) => css.match(new RegExp(String.raw`${name}:\s*([^;]+);`))?.[1].trim();

describe('public/bts/index.html token copies', () => {
  const page = read('public/bts/index.html');
  const colors = read('src/ui/tokens/colors.css');
  const motion = read('src/ui/tokens/motion.css');

  it.each([
    '--clr-petrol-50',
    '--clr-petrol-300',
    '--clr-petrol-400',
    '--clr-petrol-700',
    '--clr-petrol-800',
    '--clr-petrol-900',
    '--clr-petrol-950',
    '--clr-teal-300',
    '--clr-teal-500',
    '--clr-gold-500',
  ])('%s equals colors.css', (name) => {
    expect(declared(colors, name)).toBeDefined();
    expect(declared(page, name)).toBe(declared(colors, name));
  });

  it.each(['--dur-press', '--dur-fast', '--dur-base', '--dur-stage', '--ease-out'])(
    '%s equals motion.css',
    (name) => {
      expect(declared(motion, name)).toBeDefined();
      expect(declared(page, name)).toBe(declared(motion, name));
    },
  );
});

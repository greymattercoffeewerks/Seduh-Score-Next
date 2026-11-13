// Test helper (not shipped: only *.test.js import it). A small CSS custom-property resolver for the token files, so a
// test can ask "what does --btn-primary-bg compute to on a paper surface, and on a stage surface?" without a browser.
//
// What it models: custom properties declared on :root, on any [data-surface], any [data-brand] (and on
// [data-surface='stage'], which only the stage context applies), resolved LAZILY through var() the way the browser does
// when every layer is declared on the same element. A var() with a fallback uses it when the name is missing. It does
// not model specificity beyond "later in the file wins", inheritance between different elements, or `@media`.
// roles.test.js backs it with a check that the role layer really is declared on every element that can re-point a
// semantic colour, which is the one place "same element" would be a lie.

import { readFileSync } from 'node:fs';

export const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Top-level and one-level-nested rules as { selector, body } (enough for the token files; at-rules are skipped over).
export function rules(css) {
  const text = stripComments(css);
  const out = [];
  let depth = 0;
  let prelude = '';
  let bodyStart = 0;
  let preludeAtDepth0 = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        preludeAtDepth0 = prelude.trim();
        bodyStart = i + 1;
      }
      depth += 1;
      prelude = '';
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        out.push({
          selector: preludeAtDepth0.replace(/\s+/g, ' '),
          body: text.slice(bodyStart, i),
        });
        prelude = '';
      }
    } else if (ch === ';' && depth === 0) {
      prelude = '';
    } else if (depth === 0) {
      prelude += ch;
    }
  }
  return out;
}

// Custom-property declarations of a rule body, in order: [name, value].
export function customProps(body) {
  const found = [];
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*((?:[^;()]|\((?:[^()]|\([^()]*\))*\))*);?/g)) {
    found.push([m[1], m[2].trim().replace(/\s+/g, ' ')]);
  }
  return found;
}

const selectorsOf = (selector) => selector.split(',').map((s) => s.trim().replace(/"/g, "'"));
const PAPER_SELECTORS = new Set([':root', '[data-surface]', '[data-brand]']);
const STAGE_SELECTORS = new Set([...PAPER_SELECTORS, "[data-surface='stage']"]);

// The custom-property map of a context: 'paper' (the default) or 'stage'. `files` are token CSS texts in load order.
export function contextMap(cssTexts, context) {
  const wanted = context === 'stage' ? STAGE_SELECTORS : PAPER_SELECTORS;
  const map = new Map();
  for (const css of cssTexts) {
    for (const { selector, body } of rules(css)) {
      if (!selectorsOf(selector).some((s) => wanted.has(s))) continue;
      for (const [name, value] of customProps(body)) map.set(name, value);
    }
  }
  return map;
}

// Resolve every var() in a value to its leaf, or throw on a name that has no declaration and no fallback.
export function resolve(value, map, trail = []) {
  return value
    .replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_all, name, fallback) => {
      if (trail.includes(name))
        throw new Error(`circular custom property ${trail.join(' -> ')} -> ${name}`);
      if (map.has(name)) return resolve(map.get(name), map, [...trail, name]);
      if (fallback != null) return resolve(fallback.trim(), map, trail);
      throw new Error(`unresolved custom property ${name}`);
    })
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export const readText = (file) => readFileSync(file, 'utf8');

// The token stylesheets in the order index.css loads them (colours before roles).
export const TOKEN_FILES = [
  'src/ui/tokens/colors.css',
  'src/ui/tokens/typography.css',
  'src/ui/tokens/spacing.css',
  'src/ui/tokens/motion.css',
  'src/ui/tokens/roles.css',
  'src/ui/tokens/density.css',
];

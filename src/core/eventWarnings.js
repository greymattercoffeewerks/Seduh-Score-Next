// "Needs attention": every warning about an event in one list, each with the link that fixes it. The format
// decides what is worth a warning (BTC: matches without times, judge-country conflicts ticked through, writes
// not yet sent; another format: its own) and hands over
//
//   [{ id, severity, text, href, actionLabel }]
//
// `severity` is error | warning | info (anything else reads as info); it orders the list (errors first, then
// warnings, then notes; the format's own order is kept inside a severity) and is said in a word beside the text,
// never by colour alone. `href` must pass core/kitLink.js's `safeHref` (a warning without one still shows, as
// text); `actionLabel` is the link's words (default "Fix this"). Format-agnostic: nothing here knows what a
// warning is about.
// Styled in components.css (`.ok-warn*`).
import { el } from './dom.js';
import { safeHref } from './kitLink.js';

export const SEVERITIES = ['error', 'warning', 'info'];

export const SEVERITY_LABELS = {
  error: 'Problem',
  warning: 'Check',
  info: 'Note',
};

const DEFAULT_ACTION_LABEL = 'Fix this';

// Pure. The warnings a list can draw, ordered: each with a non-empty id (a repeat keeps the first) and text, a
// known severity (else info), a usable href (or null) and an action label. Anything else is dropped.
export function normaliseWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  const seen = new Set();
  const out = [];
  for (const warning of warnings) {
    const id = typeof warning?.id === 'string' ? warning.id.trim() : '';
    const text = typeof warning?.text === 'string' ? warning.text.trim() : '';
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    const actionLabel =
      typeof warning.actionLabel === 'string' && warning.actionLabel.trim() !== ''
        ? warning.actionLabel.trim()
        : DEFAULT_ACTION_LABEL;
    out.push({
      id,
      text,
      severity: SEVERITIES.includes(warning.severity) ? warning.severity : 'info',
      href: safeHref(warning.href),
      actionLabel,
    });
  }
  // Array.prototype.sort is stable, so the format's own order holds inside a severity.
  return out.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

// Pure. How many warnings of each severity: { error, warning, info, total }.
export function countBySeverity(warnings) {
  const counts = { error: 0, warning: 0, info: 0, total: 0 };
  for (const warning of normaliseWarnings(warnings)) {
    counts[warning.severity] += 1;
    counts.total += 1;
  }
  return counts;
}

/**
 * DOM. The warnings card. With nothing to say it still renders, saying so in words (a silent card reads as one
 * that failed to load).
 * @param {object[]} warnings the format's warnings (see the file comment)
 * @param {{ heading?: string, emptyText?: string }} [options]
 * @returns {HTMLElement}
 */
export function buildEventWarnings(
  warnings,
  { heading = 'Needs attention', emptyText = 'Nothing needs attention.' } = {},
) {
  const list = normaliseWarnings(warnings);
  const headingNode = el('h2', {
    className: 'ok-card-heading',
    id: 'ok-warn-heading',
    text: heading,
  });
  if (list.length > 0) {
    headingNode.append(
      ' ',
      el('span', { className: 'ok-warn-count', text: String(list.length) }),
      el('span', { className: 'sr-only', text: list.length === 1 ? ' item' : ' items' }),
    );
  }
  const body =
    list.length === 0
      ? el('p', { className: 'ok-warn-empty', text: emptyText })
      : el(
          'ul',
          { className: 'ok-warn-list', attrs: { role: 'list' } },
          list.map((warning) => {
            const parts = [
              el('span', {
                className: 'ok-tag ok-warn-tag',
                text: SEVERITY_LABELS[warning.severity],
                attrs: { 'data-severity': warning.severity },
              }),
              el('span', { className: 'ok-warn-text', text: warning.text }),
            ];
            if (warning.href) {
              parts.push(
                el('a', {
                  className: 'btn btn-outline tap-target ok-warn-action',
                  text: warning.actionLabel,
                  attrs: { href: warning.href },
                }),
              );
            }
            return el(
              'li',
              { className: 'ok-warn-item', attrs: { 'data-severity': warning.severity } },
              parts,
            );
          }),
        );
  return el(
    'section',
    { className: 'ok-card ok-warn', attrs: { 'aria-labelledby': 'ok-warn-heading' } },
    [headingNode, body],
  );
}

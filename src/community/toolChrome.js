// The shared frame around a free community tool, built once so every tool looks like part of the same shelf:
//
//   1. the public site header (Community Tools marked as the current section),
//   2. a breadcrumb "Community Tools / <tool>" with the tool's own controls on the same row,
//   ...the tool itself, between `top` and `bottom`...
//   3. a "More free community tools" strip listing the OTHER tools (names and pitches from communityTools.js,
//      the same list the hub's cards read) and a link to the hub,
//   4. a footer line.
//
// A tool calls buildCommunityToolChrome() once, puts `top` above its own <main> and `bottom` below it, and
// fills `controls` with its buttons. Nothing here knows about any one tool: the Random Selector adopts it
// first; the Timer, Brew Planner and Guess the Bean adopt it the same way (2026-11-19).
//
// The chrome is built once and never rebuilt, so the header's open menu survives a tool re-rendering.
// `setPresenting(true)` hides the header, the breadcrumb and the strip for a full-screen view (the footer
// too) and leaves the `controls` row on screen, because Exit lives in it.
import { brandLockup, el } from '../core/dom.js';
import { buildPublicHeader } from '../marketing/publicHeader.js';
import { COMMUNITY_HUB_HREF, otherCommunityTools } from './communityTools.js';
import { communityToolCard } from './toolCard.js';

/**
 * @param {object} options
 * @param {string} options.toolId    the tool's id in communityTools.js (it is left out of its own strip)
 * @param {string} options.toolName  shown as the current page in the breadcrumb
 * @param {string} [options.edition] right-hand footer text, e.g. "Split-flap edition"
 * @returns {{ top: HTMLElement, controls: HTMLElement, bottom: HTMLElement,
 *             setPresenting: (on: boolean, options?: { keepBar?: boolean }) => void }}
 */
export function buildCommunityToolChrome({ toolId, toolName, edition }) {
  // The public header is drawn for the dark "stage" surface; the tool's own page may be paper.
  const header = el('div', { className: 'ct-header', attrs: { 'data-surface': 'stage' } }, [
    buildPublicHeader({ active: 'community' }),
  ]);
  const crumbs = el('nav', { className: 'ct-crumbs', attrs: { 'aria-label': 'Breadcrumb' } }, [
    el('a', {
      className: 'ct-crumb-link',
      text: 'Community Tools',
      attrs: { href: COMMUNITY_HUB_HREF },
    }),
    el('span', { className: 'ct-crumb-sep', text: '/', attrs: { 'aria-hidden': 'true' } }),
    el('span', {
      className: 'ct-crumb-current',
      text: toolName,
      attrs: { 'aria-current': 'page' },
    }),
  ]);
  // Shown only while presenting, when the header is gone: the brand stays on the screen.
  const presentBrand = el('span', { className: 'ct-present-brand' }, [brandLockup()]);
  presentBrand.hidden = true;
  const controls = el('div', { className: 'ct-controls' });
  const bar = el('div', { className: 'ct-bar' }, [
    el('div', { className: 'ct-bar-inner' }, [crumbs, presentBrand, controls]),
  ]);
  const top = el('div', { className: 'ct-top' }, [header, bar]);

  const strip = el(
    'section',
    {
      className: 'ct-strip',
      attrs: { 'aria-labelledby': 'ct-more-title', 'data-surface': 'stage' },
    },
    [
      el('div', { className: 'ct-strip-inner' }, [
        el('div', { className: 'ct-strip-head' }, [
          el('div', {}, [
            el('p', { className: 'ct-strip-kicker', text: 'More free community tools' }),
            el('h2', { id: 'ct-more-title', text: 'Running an event? These help too.' }),
          ]),
          el('a', {
            className: 'ct-strip-all',
            text: 'See all Community Tools →',
            attrs: { href: COMMUNITY_HUB_HREF },
          }),
        ]),
        el(
          'div',
          { className: 'ct-strip-grid' },
          otherCommunityTools(toolId).map((tool) => communityToolCard(tool, { variant: 'strip' })),
        ),
      ]),
    ],
  );
  const footer = el('footer', { className: 'ct-footer', attrs: { 'data-surface': 'stage' } }, [
    el('div', { className: 'ct-footer-inner' }, [
      el('span', { text: 'Seduh Score · Free community tools, no account needed' }),
      ...(edition ? [el('span', { text: `${toolName} · ${edition}` })] : []),
    ]),
  ]);
  const bottom = el('div', { className: 'ct-bottom' }, [strip, footer]);

  // `keepBar: false` is for a tool whose full-screen view has no controls of its own to keep (the Timer's countdown):
  // the whole frame, bar included, goes away.
  function setPresenting(on, { keepBar = true } = {}) {
    header.hidden = on;
    crumbs.hidden = on;
    presentBrand.hidden = !on || !keepBar;
    bar.hidden = on && !keepBar;
    strip.hidden = on;
    footer.hidden = on;
    top.dataset.presenting = String(on);
  }
  setPresenting(false);

  return { top, controls, bottom, setPresenting };
}

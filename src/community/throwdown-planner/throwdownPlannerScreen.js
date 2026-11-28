// Throwdown Bracket Planner: a free Community tool. Type how many brewers you expect and see how a Throwdown bracket
// plays out: rounds, byes, who could rest twice, the 3rd place match, the Final, and what a redemption round does.
// No account, no event, no Supabase, nothing saved or sent.
//
// The ONE reasoned exception to "a tool never imports from src/formats/": the planner IS Throwdown's rules, and a copy
// would drift from the database. It imports only pure, DOM-free helpers: the engine (`bracketPreview.js`, held to the real
// bracket by a vitest and by pgTAP 096) and the words (`bracketPreviewCard.js` exports `flagWords`, `summaryWords`,
// `diffWords`; its card builder is not used). Its own DOM and CSS stay here. See src/community/throwdown-planner/CLAUDE.md.
import { el, withFocusPreservation } from '../../core/dom.js';
import { statusMark } from '../../core/vocabulary.js';
import { buildCommunityToolChrome } from '../toolChrome.js';
import { previewShape, comparePreviews } from '../../formats/throwdown/bracketPreview.js';
import {
  MAX_PREVIEW_ENTRANTS,
  diffWords,
  flagWords,
  summaryWords,
} from '../../formats/throwdown/bracketPreviewCard.js';
import { MAX_CAP, MAX_FEED_ROUND } from '../../formats/throwdown/redemption.js';

export const DEFAULT_BREWERS = 16;
const MIN_BREWERS = 2;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function initialState() {
  return {
    brewers: DEFAULT_BREWERS,
    thirdPlace: true,
    redemption: { on: false, feed: [1], cap: 0 },
  };
}

// The shape for a state: pure, so a test can read it without a DOM.
export function shapeOf(state) {
  const red = state.redemption.on
    ? { feed: state.redemption.feed, groupSize: 2, cap: state.redemption.cap }
    : null;
  return previewShape({ entrants: state.brewers, thirdPlace: state.thirdPlace, redemption: red });
}

export function mountThrowdownPlanner(root) {
  const state = initialState();
  const chrome = buildCommunityToolChrome({
    toolId: 'throwdown-planner',
    toolName: 'Throwdown Bracket Planner',
    edition: 'Knockout edition',
  });
  const host = el('div', { className: 'tp-host' });
  root.replaceChildren(chrome.top, host, chrome.bottom);

  function numberField({ label, value, min, max, key, onValue }) {
    const input = el('input', {
      className: 'tp-input',
      attrs: {
        type: 'number',
        min: String(min),
        max: String(max),
        inputmode: 'numeric',
        value: String(value),
        'data-focus-key': key,
      },
    });
    input.addEventListener('change', () => {
      const n = input.value.trim() === '' ? NaN : Math.trunc(Number(input.value));
      onValue(Number.isFinite(n) ? Math.min(Math.max(n, min), max) : value);
    });
    return el('label', { className: 'tp-field' }, [el('span', { text: label }), input]);
  }

  function checkbox({ label, checked, key, onChange }) {
    const box = el('input', { attrs: { type: 'checkbox', 'data-focus-key': key } });
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));
    return el('label', { className: 'tp-check' }, [box, el('span', { text: label })]);
  }

  function controls() {
    const red = state.redemption;
    const parts = [
      numberField({
        label: 'Brewers',
        value: state.brewers,
        min: MIN_BREWERS,
        max: MAX_PREVIEW_ENTRANTS,
        key: 'tp-brewers',
        onValue: (n) => {
          state.brewers = n;
          render();
        },
      }),
      checkbox({
        label: 'Play a 3rd place match',
        checked: state.thirdPlace,
        key: 'tp-third',
        onChange: (v) => {
          state.thirdPlace = v;
          render();
        },
      }),
      checkbox({
        label: 'Redemption rounds',
        checked: red.on,
        key: 'tp-red',
        onChange: (v) => {
          red.on = v;
          if (v && !red.feed.length) red.feed = [1];
          render();
        },
      }),
    ];
    if (red.on) {
      parts.push(
        el('fieldset', { className: 'tp-group' }, [
          el('legend', { text: 'Redemption after' }),
          ...Array.from({ length: MAX_FEED_ROUND }, (_, i) => i + 1).map((n) =>
            checkbox({
              label: `Round ${n}`,
              checked: red.feed.includes(n),
              key: `tp-feed-${n}`,
              onChange: (v) => {
                red.feed = v ? [...red.feed, n].sort() : red.feed.filter((x) => x !== n);
                render();
              },
            }),
          ),
        ]),
        numberField({
          label: 'Most who come back (0 = no limit)',
          value: red.cap,
          min: 0,
          max: MAX_CAP,
          key: 'tp-cap',
          onValue: (n) => {
            red.cap = n;
            render();
          },
        }),
      );
    }
    return el('section', { className: 'tp-panel', attrs: { 'aria-labelledby': 'tp-setup-h' } }, [
      el('h2', { id: 'tp-setup-h', text: 'Your event' }),
      ...parts,
    ]);
  }

  function result(shape) {
    const out = [
      el('h2', { id: 'tp-result-h', text: 'What will happen' }),
      el('p', {
        className: 'tp-summary',
        text: summaryWords(shape),
        attrs: { 'aria-live': 'polite' },
      }),
    ];
    if (shape.problem)
      return el(
        'section',
        { className: 'tp-panel', attrs: { 'aria-labelledby': 'tp-result-h' } },
        out,
      );
    out.push(
      el(
        'ul',
        { className: 'tp-stats' },
        [
          ['Rounds', shape.totals.rounds],
          ['Matches', shape.totals.matches],
          [shape.totals.byes === 1 ? 'Bye' : 'Byes', shape.totals.byes],
          ['Final', `${shape.totals.finalSize} brewers`],
          ['3rd place', shape.thirdPlace.played ? 'Played' : 'No'],
        ].map(([label, value]) =>
          el('li', {}, [el('strong', { text: String(value) }), el('span', { text: ` ${label}` })]),
        ),
      ),
    );
    if (shape.flags.length) {
      out.push(
        el('h3', { text: `${plural(shape.flags.length, 'thing')} to check` }),
        el(
          'ul',
          { className: 'tp-flags' },
          shape.flags.map((f) => {
            const w = flagWords(f);
            return el('li', { className: 'tp-flag' }, [
              el('strong', { text: w.title }),
              el('span', { text: ` ${w.text}` }),
            ]);
          }),
        ),
      );
    }
    out.push(
      el('h3', { text: 'Round by round' }),
      el(
        'ol',
        { className: 'tp-rounds' },
        shape.rounds.map((r) =>
          el('li', { className: 'tp-round' }, [
            el('strong', { text: r.label }),
            el('span', {
              text: ` ${r.enter} in, ${plural(r.matches, 'match', 'matches')}, ${r.through} through`,
            }),
            r.byes
              ? statusMark(
                  r.byeAgain ? 'attention' : 'queued',
                  r.byeAgain ? (r.byeAgain.certain ? 'Rests again' : 'May rest again') : '1 bye',
                )
              : document.createTextNode(''),
            r.redemption
              ? el('span', {
                  className: 'tp-note',
                  text: `Redemption: ${plural(r.redemption.pool, 'loser')} into ${plural(r.redemption.groups, 'group')}, ${r.redemption.back} come back.`,
                })
              : document.createTextNode(''),
          ]),
        ),
      ),
    );
    // what flipping a choice would change, against the same brewers
    const other3 = previewShape({
      entrants: state.brewers,
      thirdPlace: !state.thirdPlace,
      redemption: state.redemption.on
        ? { feed: state.redemption.feed, groupSize: 2, cap: state.redemption.cap }
        : null,
    });
    const flipRed = previewShape({
      entrants: state.brewers,
      thirdPlace: state.thirdPlace,
      redemption: state.redemption.on ? null : { feed: [1], groupSize: 2, cap: 0 },
    });
    const third = diffWords(comparePreviews(shape, other3));
    const red = diffWords(comparePreviews(shape, flipRed));
    out.push(
      el('h3', { text: 'What if you changed it?' }),
      el('p', {
        className: 'tp-note',
        text: state.redemption.on
          ? `With redemption off: ${red.join(', ') || 'no change to rounds, matches or byes'}.`
          : `With redemption after Round 1: ${red.join(', ') || 'no change to rounds, matches or byes'}.`,
      }),
      el('p', {
        className: 'tp-note',
        text: third.length
          ? `With 3rd place ${state.thirdPlace ? 'off' : 'on'}: ${third.join(', ')}.`
          : `3rd place ${state.thirdPlace ? 'off' : 'on'} would change nothing here.`,
      }),
    );
    return el(
      'section',
      { className: 'tp-panel', attrs: { 'aria-labelledby': 'tp-result-h' } },
      out,
    );
  }

  function render() {
    withFocusPreservation(host, () => {
      const shape = shapeOf(state);
      host.replaceChildren(
        el('main', { className: 'tp' }, [
          el('header', { className: 'tp-header' }, [
            el('h1', { text: 'Throwdown Bracket Planner' }),
            el('p', {
              className: 'tp-intro',
              text: 'How many brewers are you expecting? See how a Throwdown knockout plays out before you run it: rounds, byes, the 3rd place match and the Final. Nothing is saved, and no account is needed.',
            }),
          ]),
          el('div', { className: 'tp-layout' }, [controls(), result(shape)]),
        ]),
      );
    });
  }

  render();
  return { unmount() {} };
}

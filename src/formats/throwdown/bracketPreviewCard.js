// The "What will happen" card on Throwdown's setup (before the draw). It shows, from counts alone, how the bracket will
// play out with the setup as it stands: rounds, matches, byes, the 3rd place match and any repeat bye (bracketPreview.js,
// which mirrors the database's own rules). "Plan the event" opens a what-if panel: a different brewer count and 3rd place
// choice, and what a change would do. Nothing here is saved or sent; the real setup is the Setup card above.
import { el } from '../../core/dom.js';
import { previewShape, comparePreviews } from './bracketPreview.js';
import { MAX_FEED_ROUND, MAX_CAP } from './redemption.js';

export const MAX_PREVIEW_ENTRANTS = 64;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// One sentence for a flag from previewShape (stable codes in, words out).
export function flagWords(flag) {
  if (flag.code === 'repeat_bye') {
    return flag.certain
      ? {
          title: `Round ${flag.round}: the brewer who rested in Round ${flag.sinceRound} rests again`,
          text: 'The bye always goes to the last brewer in order, and that brewer is last again.',
        }
      : {
          title: `Round ${flag.round}: the same brewer could rest again`,
          text: `They rested in Round ${flag.sinceRound}. About 1 in ${flag.oneIn} that they rest here too, depending on who wins.`,
        };
  }
  if (flag.code === 'third_place_skipped') {
    return flag.reason === 'no_semifinals'
      ? { title: 'No 3rd place match', text: 'With two brewers there are no semi-finals.' }
      : {
          title: 'No 3rd place match',
          text: 'The round before the Final has a bye, so there are not two semi-final losers.',
        };
  }
  if (flag.code === 'redemption_unused') {
    return {
      title: `Redemption after Round ${flag.round} does nothing`,
      text: 'It needs more than 4 winners left and at least 2 brewers who lost.',
    };
  }
  return { title: flag.code, text: '' };
}

export function summaryWords(plan) {
  if (plan.problem) return 'Add at least two competitors to see how the bracket will play out.';
  const { rounds, matches, byes } = plan.totals;
  const third = plan.thirdPlace.played
    ? 'A 3rd place match is played.'
    : plan.thirdPlace.setting
      ? 'No 3rd place match.'
      : '3rd place is off.';
  const red = plan.rounds.filter((r) => r.redemption);
  const back = red.reduce((n, r) => n + r.redemption.back, 0);
  const redemption = red.length ? ` Redemption brings back up to ${plural(back, 'brewer')}.` : '';
  return `With ${plural(plan.entrants, 'brewer')}: ${plural(rounds, 'round')}, ${plural(matches, 'match', 'matches')}, ${byes === 0 ? 'no byes' : plural(byes, 'bye')}. ${third}${redemption}`;
}

const DIFF_WORDS = {
  rounds: (d) => `rounds ${d.from} to ${d.to}`,
  matches: (d) => `matches ${d.from} to ${d.to}`,
  byes: (d) => `byes ${d.from} to ${d.to}`,
  thirdPlace: (d) => (d.to ? '3rd place match played' : 'no 3rd place match'),
  repeatByes: (d) => `repeat byes ${d.from} to ${d.to}`,
};
export const diffWords = (diffs) => diffs.map((d) => DIFF_WORDS[d.key](d));

// plan = { open, entrants, thirdPlace, redemption }: the what-if, each null while the card follows the roster and the setup.
// A redemption what-if is { on, feed, cap }; `redemption` (a prop) is the setup form's own { on, groupSize, cap, feed }.
export function createBracketPreviewCard({
  rosterCount,
  thirdPlace,
  redemption = null,
  plan,
  onChange,
  setupHint = 'Change the real setup above.',
}) {
  const entrants = plan.entrants ?? rosterCount;
  const third = plan.thirdPlace ?? thirdPlace;
  const groupSize = redemption?.groupSize ?? 2;
  const setupRed = redemption?.on
    ? { feed: redemption.feed, groupSize, cap: redemption.cap }
    : null;
  const what = plan.open ? plan.redemption : null;
  const effRed = what ? (what.on ? { feed: what.feed, groupSize, cap: what.cap } : null) : setupRed;
  const shape = previewShape({
    entrants,
    thirdPlace: plan.open ? third : thirdPlace,
    redemption: effRed,
  });
  const children = [
    el('h2', { id: 'td-preview-h', text: 'What will happen' }),
    el('p', { className: 'td-note', text: summaryWords(shape), attrs: { 'aria-live': 'polite' } }),
  ];
  if (!shape.problem && shape.flags.length) {
    children.push(
      el('p', {
        className: 'td-note',
        text: `${plural(shape.flags.length, 'thing')} to check.`,
      }),
    );
  }
  const toggle = el('button', {
    className: 'btn btn-outline tap-target',
    text: plan.open ? 'Close the plan' : 'Plan the event',
    attrs: {
      type: 'button',
      'aria-expanded': String(plan.open),
      'aria-controls': 'td-plan',
      'data-focus-key': 'td-plan-toggle',
      'data-tour': 'td-plan',
    },
  });
  toggle.addEventListener('click', () =>
    onChange(
      plan.open
        ? { open: false, entrants: null, thirdPlace: null, redemption: null }
        : { open: true },
    ),
  );
  children.push(toggle);

  if (plan.open) {
    const count = el('input', {
      className: 'field-input',
      attrs: {
        type: 'number',
        min: '2',
        max: String(MAX_PREVIEW_ENTRANTS),
        inputmode: 'numeric',
        value: String(entrants),
        'aria-label': 'Brewers to plan for',
        'data-focus-key': 'td-plan-count',
      },
    });
    count.addEventListener('change', () => {
      // an empty or non-numeric box goes back to the roster's count; a number is kept within 0 to 64
      const n = count.value.trim() === '' ? NaN : Math.trunc(Number(count.value));
      onChange({
        entrants: Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_PREVIEW_ENTRANTS) : null,
      });
    });
    const thirdBox = el('input', {
      attrs: { type: 'checkbox', 'data-focus-key': 'td-plan-third' },
    });
    thirdBox.checked = third;
    thirdBox.addEventListener('change', () => onChange({ thirdPlace: thirdBox.checked }));
    const redBox = el('input', { attrs: { type: 'checkbox', 'data-focus-key': 'td-plan-red' } });
    redBox.checked = Boolean(effRed);
    redBox.addEventListener('change', () =>
      onChange({
        redemption: {
          on: redBox.checked,
          feed: effRed?.feed?.length ? effRed.feed : [1],
          cap: Number.isInteger(effRed?.cap) ? effRed.cap : 0,
        },
      }),
    );
    const redControls = [];
    if (effRed) {
      const setRed = (patch) =>
        onChange({
          redemption: {
            on: true,
            feed: effRed.feed,
            cap: Number.isInteger(effRed.cap) ? effRed.cap : 0,
            ...patch,
          },
        });
      const capInput = el('input', {
        className: 'field-input',
        attrs: {
          type: 'number',
          min: '0',
          max: String(MAX_CAP),
          inputmode: 'numeric',
          value: String(Number.isInteger(effRed.cap) ? effRed.cap : 0),
          'aria-label': 'At most this many brewers come back (0 is no limit)',
          'data-focus-key': 'td-plan-cap',
        },
      });
      capInput.addEventListener('change', () => {
        const n = capInput.value.trim() === '' ? 0 : Math.trunc(Number(capInput.value));
        setRed({ cap: Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_CAP) : 0 });
      });
      redControls.push(
        el('fieldset', { className: 'td-choice-group' }, [
          el('legend', { text: 'Redemption after' }),
          ...Array.from({ length: MAX_FEED_ROUND }, (_, i) => i + 1).map((n) => {
            const box = el('input', {
              attrs: { type: 'checkbox', 'data-focus-key': `td-plan-feed-${n}` },
            });
            box.checked = effRed.feed.includes(n);
            box.addEventListener('change', () =>
              setRed({
                feed: box.checked ? [...effRed.feed, n] : effRed.feed.filter((x) => x !== n),
              }),
            );
            return el('label', { className: 'td-choice' }, [
              box,
              document.createTextNode(` Round ${n}`),
            ]);
          }),
        ]),
        el('label', { className: 'td-choice' }, [
          document.createTextNode('Most who come back (0 = no limit) '),
          capInput,
        ]),
      );
    }
    const panel = [
      el('p', {
        className: 'td-note',
        text: `A plan only: nothing here is saved.${setupHint ? ` ${setupHint}` : ''}`,
      }),
      el('label', { className: 'td-choice' }, [
        document.createTextNode('Brewers '),
        count,
        document.createTextNode(` (roster has ${rosterCount})`),
      ]),
      el('label', { className: 'td-choice' }, [
        thirdBox,
        document.createTextNode(' Play a 3rd place match'),
      ]),
      el('label', { className: 'td-choice' }, [
        redBox,
        document.createTextNode(' Redemption rounds'),
      ]),
      ...redControls,
    ];
    if (shape.problem) {
      panel.push(el('p', { className: 'td-note', text: summaryWords(shape) }));
    } else {
      panel.push(
        el(
          'ul',
          { className: 'td-plan-stats' },
          [
            ['Rounds', shape.totals.rounds],
            ['Matches', shape.totals.matches],
            ['Byes', shape.totals.byes],
            ['Final', `${shape.totals.finalSize} brewers`],
            ['3rd place', shape.thirdPlace.played ? 'Played' : 'No'],
          ].map(([label, value]) =>
            el('li', {}, [
              el('strong', { text: String(value) }),
              el('span', { text: ` ${label}` }),
            ]),
          ),
        ),
      );
      if (shape.flags.length) {
        panel.push(
          el(
            'ul',
            { className: 'td-plan-flags' },
            shape.flags.map((f) => {
              const w = flagWords(f);
              return el('li', { className: 'td-plan-flag' }, [
                el('strong', { text: w.title }),
                el('span', { text: ` ${w.text}` }),
              ]);
            }),
          ),
        );
      }
      panel.push(
        el(
          'ol',
          { className: 'td-plan-rounds' },
          shape.rounds.map((r) =>
            el('li', { className: 'td-plan-round' }, [
              el('strong', { text: r.label }),
              el('span', { text: ` ${r.enter} in, ${plural(r.matches, 'match', 'matches')}` }),
              r.byes
                ? el('span', {
                    className: 'status',
                    text: r.byeAgain
                      ? r.byeAgain.certain
                        ? 'Rests again'
                        : 'May rest again'
                      : '1 bye',
                  })
                : document.createTextNode(''),
              el('span', { className: 'td-note', text: ` ${r.through} through` }),
              r.redemption
                ? el('span', {
                    className: 'td-note td-plan-redemption',
                    text: `Redemption: ${plural(r.redemption.pool, 'loser')} into ${plural(r.redemption.groups, 'group')}, ${r.redemption.back} come back.`,
                  })
                : document.createTextNode(''),
            ]),
          ),
        ),
      );
      // what a 3rd place change would do, against the other choice
      const other = previewShape({ entrants, thirdPlace: !third });
      const diffs = diffWords(comparePreviews(shape, other));
      const flipRed = previewShape({
        entrants,
        thirdPlace: third,
        redemption: effRed ? null : { feed: [1], groupSize, cap: 0 },
      });
      const redDiffs = diffWords(comparePreviews(shape, flipRed));
      panel.push(
        el('p', {
          className: 'td-note',
          text: effRed
            ? `If redemption were off: ${redDiffs.join(', ') || 'no change'}.`
            : `If redemption were on after Round 1: ${redDiffs.join(', ') || 'no change'}.`,
        }),
      );
      panel.push(
        el('p', {
          className: 'td-note',
          text: diffs.length
            ? `If 3rd place were ${third ? 'off' : 'on'}: ${diffs.join(', ')}.`
            : `3rd place ${third ? 'off' : 'on'} would change nothing here.`,
        }),
      );
    }
    children.push(el('div', { id: 'td-plan', className: 'td-plan' }, panel));
  } else {
    // kept in the page, hidden, so the button's aria-controls always names something
    children.push(el('div', { id: 'td-plan', className: 'td-plan', attrs: { hidden: '' } }));
  }
  return el(
    'section',
    {
      className: 'card td-card',
      attrs: { 'aria-labelledby': 'td-preview-h', 'data-tour': 'td-preview' },
    },
    children,
  );
}

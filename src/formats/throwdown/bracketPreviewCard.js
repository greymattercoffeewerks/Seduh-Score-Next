// The "What will happen" card on Throwdown's setup (before the draw). It shows, from counts alone, how the bracket will
// play out with the setup as it stands: rounds, matches, byes, the 3rd place match and any repeat bye (bracketPreview.js,
// which mirrors the database's own rules). "Plan the event" opens a what-if panel: a different brewer count and 3rd place
// choice, and what a change would do. Nothing here is saved or sent; the real setup is the Setup card above.
import { el } from '../../core/dom.js';
import { previewShape, comparePreviews } from './bracketPreview.js';

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
  return `With ${plural(plan.entrants, 'brewer')}: ${plural(rounds, 'round')}, ${plural(matches, 'match', 'matches')}, ${byes === 0 ? 'no byes' : plural(byes, 'bye')}. ${third}`;
}

const DIFF_WORDS = {
  rounds: (d) => `rounds ${d.from} to ${d.to}`,
  matches: (d) => `matches ${d.from} to ${d.to}`,
  byes: (d) => `byes ${d.from} to ${d.to}`,
  thirdPlace: (d) => (d.to ? '3rd place match played' : 'no 3rd place match'),
  repeatByes: (d) => `repeat byes ${d.from} to ${d.to}`,
};
export const diffWords = (diffs) => diffs.map((d) => DIFF_WORDS[d.key](d));

// plan = { open, entrants (what-if, or null for the roster's), thirdPlace (what-if, or null for the setup's) }
export function createBracketPreviewCard({ rosterCount, thirdPlace, plan, onChange }) {
  const entrants = plan.entrants ?? rosterCount;
  const third = plan.thirdPlace ?? thirdPlace;
  const shape = previewShape({ entrants, thirdPlace: plan.open ? third : thirdPlace });
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
    },
  });
  toggle.addEventListener('click', () =>
    onChange(plan.open ? { open: false, entrants: null, thirdPlace: null } : { open: true }),
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
    const panel = [
      el('p', {
        className: 'td-note',
        text: 'A plan only: nothing here is saved. Change the real setup above.',
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
            ]),
          ),
        ),
      );
      // what a 3rd place change would do, against the other choice
      const other = previewShape({ entrants, thirdPlace: !third });
      const diffs = diffWords(comparePreviews(shape, other));
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
    { className: 'card td-card', attrs: { 'aria-labelledby': 'td-preview-h' } },
    children,
  );
}

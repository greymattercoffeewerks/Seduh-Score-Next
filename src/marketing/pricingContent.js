// The pricing page's copy and its tier-by-feature matrix, in one editable place.
//
// Tier assignments confirmed by the owner on 2026-10-17: the 8-participant limit on Community,
// Annual's full access, Per-event as one event in one format, the result listing rule
// (Compulsory / Optional / Optional), and the other rows as drafted. Changed 2026-10-23: BTC is
// Per-event and Annual only (not on Community), and Community runs one active event at a time.
// Gating is not built yet (Handoffs and Specs/GATING-SPEC.md), so nothing here is enforced
// by the product; the page says the limits are being switched on step by step.
//   - the three tiers and their prices come from the landing page's pricing section;
//   - "Included" for every tier means it exists in the product today;
//   - "Planned" means it is not built yet (the page says so in words).
// Change the cells here and nowhere else; pricingScreen.test.js checks the matrix is
// complete and every state has a word, not just a symbol.
//
// Claims must stay true: this module's CLAUDE.md says not to add copy for a capability
// that is not real product scope. A feature that is not built yet is `soon`, never `yes`.

export const TIERS = [
  {
    id: 'community',
    name: 'Community',
    price: 'Free',
    suffix: null,
    summary: 'For getting started. Up to 8 competitors, and one active event at a time.',
    // The tier's archive rule (owner, 2026-10-17). Automatic enforcement is the archive
    // phase (infrastructure plan, step 4); until then publishing is the organiser's choice
    // on every tier, so this states the tier's policy ahead of the code.
    note: 'The podium is published to the public archive automatically, about 24 hours after the event ends. You can publish sooner.',
    cta: { text: 'Get in touch', href: '/contact/' },
  },
  {
    id: 'per-event',
    name: 'Per-event',
    price: 'BND $18',
    suffix: 'one-time',
    summary: 'One event, in the format you choose, with reports. Pay once, run your event, done.',
    note: 'You choose whether to publish results to the public archive. If you do not, the event is still named there, with no results.',
    cta: { text: 'Get in touch', href: '/contact/' },
    featured: true,
  },
  {
    id: 'annual',
    name: 'Annual',
    price: 'BND $350',
    suffix: 'per year',
    summary:
      'For organisers running events all year, with full access to every format and feature.',
    note: 'You choose whether to publish results to the public archive. If you do not, the event is still named there, with no results.',
    cta: { text: 'Get in touch', href: '/contact/' },
  },
];

const yes = { state: 'yes' };
const no = { state: 'no' };
const soon = { state: 'soon' };
const text = (value) => ({ state: 'text', text: value });

// Each row: [feature, description, [community, per-event, annual]].
export const FEATURE_GROUPS = [
  {
    id: 'formats',
    title: 'Competition formats',
    rows: [
      [
        'Cup Taster',
        'Blind-set sensory heats, scored for accuracy with time as the tiebreaker. Up to 8 competitors on Community.',
        [yes, yes, yes],
      ],
      [
        'BTC',
        'Team head-to-head: round-robin prelims, a seeded bracket and automatic advancement. Per-event and Annual only, with no competitor limit.',
        [no, yes, yes],
      ],
    ],
  },
  {
    id: 'floor',
    title: 'Running the floor',
    rows: [
      [
        'Timing, scoring and standings',
        'Timing, scoring, standings and advancement handled for you.',
        [yes, yes, yes],
      ],
      [
        'Roster and registration',
        'Add competitors and teams, and edit them as the day changes.',
        [yes, yes, yes],
      ],
      // Owner, 2026-10-17: Per-event and Annual only; Community organisers manage registration
      // themselves. Not built (it is Seduh ID Layer 2), so Planned.
      [
        'Event registration page',
        'A public page where competitors register for your event and join your roster. On Community, you manage registration yourself.',
        [no, soon, soon],
      ],
      [
        'Keeps scoring through wifi drops',
        'Entries queue on the device and sync when the connection returns.',
        [yes, yes, yes],
      ],
      // Owner, 2026-10-17 and 2026-10-23: Community has Cup Taster (and Throwdown and Liga Seduh
      // when they ship) limited to 8 participants, one active event at a time, and no BTC;
      // Annual has full access; Per-event covers one event in one format, with no cap, BTC
      // included. Nothing enforces any of it yet: caps are decision D-G3 in
      // GATING-SPEC.md. The 5-day Per-event window (D-G15) is confirmed but deliberately not on
      // the page yet: when it starts and the CSV email at its end are still open.
      [
        'Events you can run',
        null,
        [
          text('Up to 8 competitors, one active event at a time'),
          text('One event, in one format'),
          text('All formats, all year, no limit'),
        ],
      ],
    ],
  },
  {
    id: 'audience',
    title: 'Audience and venue',
    rows: [
      [
        'Projector, phone and splash screens',
        'Live standings for the room, on any screen, from a shared link or QR code.',
        [yes, yes, yes],
      ],
      // Not built: audience branding exists only as an intended feature. Owner, 2026-10-17: the
      // offer is Level 2 (logo, accent colour, name, banner images), worded "Branded", with
      // "Powered by Seduh Score" always kept (GATING-SPEC section 6c, D-G17).
      [
        'Your own branding on audience screens',
        'Your logo, accent colour and name, plus banner images, on the projector, phone and splash screens. "Powered by Seduh Score" stays on every branded screen.',
        [no, soon, soon],
      ],
    ],
  },
  {
    id: 'results',
    title: 'Reports and results',
    rows: [
      [
        'Result listing',
        'Cup Taster: the podium or full standings on a page anyone can open. On Community, the podium is published to the public archive automatically, about 24 hours after the event ends. On Per-event and Annual, listing is your choice, and an event that is not listed is still named in the archive.',
        [
          text('Compulsory: podium only, published about 24 hours after the event ends'),
          text('Optional (the event is always named)'),
          text('Optional (the event is always named)'),
        ],
      ],
      // The landing page puts PDF reports on Per-event and Annual only.
      [
        'Printable report and CSV export',
        'Cup Taster: a report you can print or save as PDF, and the data as CSV.',
        [no, yes, yes],
      ],
      // Analytics is an Annual feature.
      [
        'Per-cupper and per-set analytics',
        'Cup Taster: see which sets caught people out, and how each cupper did.',
        [no, no, yes],
      ],
      // Not built: needs the results archive (infrastructure plan, step 4).
      ['History across seasons', null, [no, no, soon]],
    ],
  },
  {
    id: 'tools',
    title: 'Community tools',
    rows: [
      [
        'Timer, Brew Planner, Random Selector, Guess the Bean',
        'Free for everyone, on every tier.',
        [yes, yes, yes],
      ],
    ],
  },
];

export const STATE_WORDS = {
  yes: 'Included',
  no: 'Not included',
  soon: 'Planned',
};

export const FAQ = [
  {
    question: 'How do I pay?',
    answer:
      'Billing is handled directly by Grey Matter Coffee Werks, in Brunei dollars. Get in touch and we will set you up. There is no card form on this site.',
  },
  {
    question: 'How do I get an account?',
    answer:
      'Organiser accounts are set up by us for now. Get in touch and tell us about your event. The free Community tools (Timer, Brew Planner and Random Selector) need no account, and Guess the Bean only asks you to sign in when you create a session.',
  },
  {
    question: 'Do my results have to be public?',
    answer:
      'On Community, yes: the podium is published to the public archive automatically, about 24 hours after the event ends, and you can publish it sooner. Tell your competitors before the event. On Per-event and Annual, publishing is your choice, and an unlisted event is still named in the archive with no results.',
  },
  {
    question: 'What does "Planned" mean?',
    answer:
      'It is not built yet. We list it so you can see where the product is going, not to sell it to you today.',
  },
  {
    question: 'What about Throwdown and Liga Seduh?',
    answer:
      'Both are planned formats. When they launch they follow the same rules as Cup Taster: up to 8 competitors on Community, one event at a time on Per-event, and included on Annual.',
  },
];

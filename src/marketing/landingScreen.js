// Marketing landing page — Seduh Score Next.
//
// "Petrol" identity, 2026-09-13 — replaces "Kinetic" (2026-09-13, same day —
// see src/marketing/CLAUDE.md's identity history for the full account of why
// a fourth rework landed hours after the third). Built from a design handoff
// produced independently (Claude Design), covering both this page and a
// full app-wide token replacement (src/ui/tokens/*) — a real architecture
// change from every previous identity: this page now imports the shared
// design system directly instead of maintaining its own separate
// `--kinetic-*`/`--cherry-*`-style token block. See landing.css's header
// comment and src/marketing/CLAUDE.md for why that's safe here specifically.
//
// Two real fixes made while porting the handoff's own design reference
// (a single-file mockup in a different tool's component format, not meant
// to be copied verbatim) into this codebase's conventions:
//   - The design reference called the fourth format "BTC" — at the time
//     this page was first built (2026-09-13), the rest of this codebase
//     still called it "BBTC" (src/formats/bbtc/, ROADMAP.md), so it was
//     "corrected" to BBTC here, the same way an earlier rework corrected a
//     fabricated nav link. That correction is now itself reversed: the app
//     renamed bbtc/ -> btc/ at the start of Phase T-BTC.2 (2026-09-18) —
//     BBTC is the Brunei-specific INSTANCE of the format, not the format's
//     own name — so the design reference's original "BTC" was right all
//     along. Fixed here 2026-09-23, alongside actually shipping BTC as a
//     live row below (it was still marked dimmed/"Soon" even after the app
//     itself had routed all 5 of its screens).
//   - The design reference hand-picked several one-off graphite/teal hex
//     values for backgrounds and text, entirely independent of the shared
//     token system (it predates the decision to import that system here).
//     Backgrounds close enough to an existing `--clr-petrol-*` ramp step
//     were snapped onto that step; text/accent colors on this page's dark
//     surfaces resolve via `data-surface="stage"` (the same mechanism the
//     console's projector view uses) rather than a hand-picked light-on-dark
//     hex — see landing.css for exactly where and why.
//
// Built with core/dom.js's el()/svgEl()/brandLockup(), same as every console
// screen (textContent-only, no innerHTML — see dom.js's own header comment
// for why).
import { el, svgEl, brandLockup } from '../core/dom.js';
import { revealOnScroll } from '../core/scrollReveal.js';
import { cleanOrgName } from '../core/orgLabel.js';
import { TIERS } from './pricingContent.js';
import { buildPublicFooter } from './publicFooter.js';

function icon(children, { className = 'petrol-icon' } = {}) {
  const svg = svgEl('svg', {
    class: className,
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
  });
  svg.append(...children);
  return svg;
}

// alertTriangle/laptop/wifiOff/trash/zap/trophy/users are the same Feather-
// style paths this page's previous identity already defined — ported
// verbatim rather than redrawn, per the handoff's own note that these are
// the exact icons it wants.
const ICONS = {
  alertTriangle: () =>
    icon([
      svgEl('path', {
        d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
      }),
      svgEl('line', { x1: '12', y1: '9', x2: '12', y2: '13' }),
      svgEl('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }),
    ]),
  laptop: () =>
    icon([
      svgEl('rect', { x: '3', y: '4', width: '18', height: '12', rx: '1' }),
      svgEl('line', { x1: '2', y1: '20', x2: '22', y2: '20' }),
    ]),
  wifiOff: () =>
    icon([
      svgEl('line', { x1: '1', y1: '1', x2: '23', y2: '23' }),
      svgEl('path', { d: 'M16.72 11.06A10.94 10.94 0 0 1 19 12.55' }),
      svgEl('path', { d: 'M5 12.55a10.94 10.94 0 0 1 5.17-2.39' }),
      svgEl('path', { d: 'M10.71 5.05A16 16 0 0 1 22.58 9' }),
      svgEl('path', { d: 'M1.42 9a15.91 15.91 0 0 1 4.7-2.88' }),
      svgEl('path', { d: 'M8.53 16.11a6 6 0 0 1 6.95 0' }),
      svgEl('line', { x1: '12', y1: '20', x2: '12.01', y2: '20' }),
    ]),
  trash: () =>
    icon([
      svgEl('polyline', { points: '3 6 5 6 21 6' }),
      svgEl('path', {
        d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
      }),
    ]),
  zap: () => icon([svgEl('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' })]),
  trophy: () =>
    icon([
      svgEl('path', { d: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z' }),
      svgEl('path', { d: 'M17 5h3a2 2 0 0 1-2 4M7 5H4a2 2 0 0 0 2 4' }),
    ]),
  users: () =>
    icon([
      svgEl('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
      svgEl('circle', { cx: '9', cy: '7', r: '4' }),
      svgEl('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
      svgEl('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
    ]),
};

function liveDot() {
  return el('span', { className: 'status-live-dot', attrs: { 'aria-hidden': 'true' } });
}

// "Org login" goes to the console root, "Start free" to its events list (no
// separate sign-up flow exists — loginScreen.js is sign-in only, D14's real
// access control is still a stub). "Formats"/"Pricing" are same-page anchors.
function navLink(text, href) {
  return el('a', { className: 'petrol-nav-link', text, attrs: { href } });
}

function actionLink(text, { primary = false, outline = false, href = '/app/#/events' } = {}) {
  const classes = ['petrol-action'];
  if (primary) classes.push('petrol-action-primary', 'cut-sm');
  if (outline) classes.push('petrol-action-outline');
  return el('a', { className: classes.join(' '), text, attrs: { href } });
}

// Single bar at every width — links/CTA hide below the CSS breakpoint,
// replaced by a hamburger toggle; the toggle only flips a class, visibility
// of desktop-vs-mobile nav is CSS-only (media query), not JS-computed
// window.innerWidth state — the design handoff explicitly calls this out as
// its own hard-won fix from an earlier draft, and it matches this
// codebase's existing nav-toggle precedent (previous identity's own
// `.kinetic-nav-panel-open` pattern).
function buildNav() {
  const brand = el('div', { className: 'petrol-brand' }, [brandLockup()]);

  const live = el('span', { className: 'petrol-live-indicator' }, [
    liveDot(),
    document.createTextNode('Live — Cup Taster, BTC'),
  ]);

  const secondary = el('span', {
    className: 'petrol-secondary-label',
    text: 'No install · no wifi dependency',
  });

  const links = el('div', { className: 'petrol-nav-links' }, [
    navLink('Formats', '#formats'),
    navLink('Pricing', '#pricing'),
    navLink('Community Tools', '/community/'),
    navLink('Results', '/results/'),
    navLink('Org login', '/app/'),
  ]);
  const desktopCta = actionLink('Start free', { primary: true });
  const desktopGroup = el('div', { className: 'petrol-nav-desktop' }, [links, desktopCta]);

  const mobileLinks = el('div', { className: 'petrol-nav-mobile-links' }, [
    navLink('Formats', '#formats'),
    navLink('Pricing', '#pricing'),
    navLink('Community Tools', '/community/'),
    navLink('Results', '/results/'),
    navLink('Org login', '/app/'),
    actionLink('Start free', { primary: true }),
  ]);
  const mobilePanel = el('div', { className: 'petrol-nav-mobile-panel', id: 'petrol-nav-panel' }, [
    mobileLinks,
  ]);

  const toggle = el('button', {
    className: 'petrol-nav-toggle',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'petrol-nav-panel',
      'aria-label': 'Menu',
    },
  });
  const burgerIcon = icon(
    [
      svgEl('line', { x1: '0', y1: '1', x2: '18', y2: '1' }),
      svgEl('line', { x1: '0', y1: '6', x2: '18', y2: '6' }),
      svgEl('line', { x1: '0', y1: '11', x2: '18', y2: '11' }),
    ],
    { className: 'petrol-nav-toggle-icon' },
  );
  burgerIcon.setAttribute('viewBox', '0 0 18 12');
  burgerIcon.setAttribute('stroke', 'currentColor');
  burgerIcon.setAttribute('stroke-width', '1.6');
  const closeIcon = icon(
    [
      svgEl('line', { x1: '1', y1: '1', x2: '15', y2: '15' }),
      svgEl('line', { x1: '15', y1: '1', x2: '1', y2: '15' }),
    ],
    { className: 'petrol-nav-toggle-icon petrol-nav-toggle-icon-close' },
  );
  closeIcon.setAttribute('viewBox', '0 0 16 16');
  closeIcon.setAttribute('stroke', 'currentColor');
  closeIcon.setAttribute('stroke-width', '1.6');
  toggle.append(burgerIcon, closeIcon);

  function closeMenu() {
    mobilePanel.classList.remove('petrol-nav-mobile-panel-open');
    toggle.classList.remove('petrol-nav-toggle-open');
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', () => {
    const open = mobilePanel.classList.toggle('petrol-nav-mobile-panel-open');
    toggle.classList.toggle('petrol-nav-toggle-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  mobilePanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      toggle.focus();
    }
  });
  mobilePanel.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  const bar = el('div', { className: 'petrol-nav-bar' }, [
    brand,
    live,
    secondary,
    desktopGroup,
    toggle,
  ]);

  return el('nav', { className: 'petrol-nav', attrs: { 'aria-label': 'Primary' } }, [
    bar,
    mobilePanel,
  ]);
}

// Five rotating full-bleed photos, crossfading on a timer — purely
// atmospheric (no caption claims a specific real event; two of them are
// real Cup Taster event photos, used as scenery), so alt text stays
// empty and the whole strip is aria-hidden; the headline/body copy right
// next to it carries the actual message. Auto-advance is skipped entirely
// under prefers-reduced-motion (the dots still work, for a visitor who
// wants to look at a specific photo) rather than fighting a suppressed CSS
// transition with a class toggle that has nowhere to animate to.
const HERO_PHOTOS = [
  { src: '/marketing/hero-tablet.jpg', alt: '' },
  { src: '/marketing/hero-projector.jpg', alt: '' },
  { src: '/marketing/hero-event-floor.jpg', alt: '', position: '50% 65%' },
  { src: '/marketing/hero-event-cupper.jpg', alt: '', position: '50% 40%' },
  { src: '/marketing/hero-bracket.jpg', alt: '' },
];
const HERO_INTERVAL_MS = 4200;

function buildHeroPhotos() {
  const frames = HERO_PHOTOS.map(({ src, alt, position }, i) => {
    const frame = el('img', {
      className: `petrol-hero-photo${i === 0 ? ' petrol-hero-photo-active' : ''}`,
      attrs: { src, alt, loading: i === 0 ? 'eager' : 'lazy' },
    });
    // The crop's focal point — the wide banner box cuts a 4:3 / portrait photo to a band.
    if (position) frame.style.objectPosition = position;
    return frame;
  });
  const dots = HERO_PHOTOS.map((_, i) =>
    el('button', {
      className: `petrol-hero-dot${i === 0 ? ' petrol-hero-dot-active' : ''}`,
      attrs: { type: 'button', 'aria-label': `Show photo ${i + 1} of ${HERO_PHOTOS.length}` },
    }),
  );

  let active = 0;
  function show(index) {
    frames[active].classList.remove('petrol-hero-photo-active');
    dots[active].classList.remove('petrol-hero-dot-active');
    active = index;
    frames[active].classList.add('petrol-hero-photo-active');
    dots[active].classList.add('petrol-hero-dot-active');
  }
  dots.forEach((dot, i) => dot.addEventListener('click', () => show(i)));

  if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    setInterval(() => show((active + 1) % HERO_PHOTOS.length), HERO_INTERVAL_MS);
  }

  const photos = el(
    'div',
    { className: 'petrol-hero-photos', attrs: { 'aria-hidden': 'true' } },
    frames,
  );
  const dotRow = el('div', { className: 'petrol-hero-dots' }, dots);
  return { photos, dotRow };
}

function statItem(value, label) {
  return el('div', { className: 'petrol-stat' }, [
    el('div', { className: 'petrol-stat-value petrol-mono tabular-nums', text: value }),
    el('div', { className: 'petrol-stat-label', text: label }),
  ]);
}

function buildHero() {
  const { photos, dotRow } = buildHeroPhotos();
  const scrim = el('div', { className: 'petrol-hero-scrim', attrs: { 'aria-hidden': 'true' } });

  const content = el('div', { className: 'petrol-hero-content' }, [
    el('p', { className: 'petrol-kicker', text: 'Grey Matter Coffee Werks · Brunei' }),
    el('h1', { className: 'petrol-display petrol-hero-headline' }, [
      document.createTextNode('One tablet.'),
      el('br'),
      document.createTextNode('One projector.'),
      el('br'),
      el('span', { text: 'Zero fall-apart.' }),
    ]),
    el('p', {
      className: 'petrol-hero-body',
      text:
        'Seduh Score runs the whole event — brackets, judging, live results — with no ' +
        'install and no dependency on venue wifi. Built for how Southeast Asian organisers ' +
        'actually run events.',
    }),
    el('div', { className: 'petrol-hero-actions' }, [
      actionLink('Start free — no account', { primary: true }),
      actionLink('Take the tour', { outline: true, href: '/tour/' }),
    ]),
    el('div', { className: 'petrol-stat-strip' }, [
      statItem('2', 'formats live'),
      statItem('0', 'installs'),
      statItem('1', 'tablet runs it'),
      statItem('3', 'tiers, public'),
    ]),
  ]);

  return el('section', { className: 'petrol-hero' }, [
    photos,
    scrim,
    el('div', { className: 'petrol-wrap petrol-hero-inner' }, [content]),
    dotRow,
  ]);
}

// Two content copies back-to-back so the -50% translateX loop never shows a
// gap before it resets — same fix this page's own previous identity already
// worked out empirically (measure vs. the container's own max width, not a
// guess), just re-verified for this line's own length against
// .petrol-wrap's 1360px cap: one copy of this line is comfortably under
// 700px at the ticker's own 12px/tracked-uppercase sizing, so two copies
// clears 1360px with real margin at any viewport.
function ticker() {
  const line =
    'Live judging / 0 installs / offline-resilient / no wifi dependency / ' +
    '3 tiers, public / built in Brunei /';
  const copies = [line, line];
  return el('div', { className: 'petrol-ticker', attrs: { 'aria-hidden': 'true' } }, [
    el(
      'div',
      { className: 'petrol-track' },
      copies.map((text) => el('span', { text })),
    ),
  ]);
}

function ledgerRow(index, iconFn, title, body) {
  return el('div', { className: 'petrol-ledger-row' }, [
    el('span', { className: 'petrol-ledger-index petrol-mono', text: index }),
    iconFn(),
    el('div', {}, [
      el('span', { className: 'petrol-ledger-title', text: title }),
      el('span', { className: 'petrol-ledger-body', text: body }),
    ]),
  ]);
}

function problemSection() {
  const left = el('div', {}, [
    el('p', { className: 'petrol-eyebrow', text: '01 · The problem' }),
    el('h2', {
      className: 'petrol-heading',
      text: 'Right now, the whole competition rides on one laptop and a group chat.',
    }),
    el('p', {
      className: 'petrol-band-body',
      text:
        'A bracket taped to the wall. Scores called out and typed into a spreadsheet one ' +
        'person guards. The wifi drops and the room waits. A result gets questioned and ' +
        "there's nothing to point to.",
    }),
  ]);

  const right = el('div', { className: 'petrol-ledger' }, [
    ledgerRow(
      '01',
      ICONS.alertTriangle,
      'Scattered scoring',
      "Slips, group chats and three half-open apps — no single source of truth for who's " +
        'winning.',
    ),
    ledgerRow(
      '02',
      ICONS.laptop,
      'One fragile laptop',
      'The whole event on one spreadsheet, one person, one point of failure.',
    ),
    ledgerRow(
      '03',
      ICONS.wifiOff,
      'Venue wifi',
      'A live run that hangs on a connection which never quite holds through the finals.',
    ),
    ledgerRow(
      '04',
      ICONS.trash,
      'Gone afterward',
      "Every result deleted once the trophy's handed out. No record, no history, no proof.",
    ),
  ]);

  const inner = el('div', { className: 'petrol-wrap petrol-problem-grid' }, [left, right]);
  const section = el('section', { className: 'petrol-band' }, [inner]);
  revealOnScroll(inner);
  return section;
}

function tag(text, { solid = false } = {}) {
  return el('span', {
    className: `petrol-tag${solid ? ' petrol-tag-solid' : ''}`,
    text,
  });
}

// Cup Taster and BTC are the two real, live formats — not dimmed,
// left-accented, and each row is a link straight into the app (both go to
// the same /app/#/events; which format an organiser gets from there is a
// per-event choice, not a per-format URL). Throwdown and Liga Seduh are
// real product scope (ROADMAP.md), just not built yet, so they stay dimmed.
// "BTC," not "BBTC" — see this file's header comment for the naming
// history (the design reference had it right; this codebase was wrong for
// a while, not the other way around).
function formatRow(index, name, body, { live = false, dimmed = false, href } = {}) {
  const classes = ['petrol-format-row'];
  if (live) classes.push('petrol-format-row-live');
  if (dimmed) classes.push('petrol-format-row-dimmed');

  const nameEl = el('span', { className: 'petrol-format-name', text: name });
  const children = [nameEl, el('span', { className: 'petrol-format-body', text: body })];
  if (live) {
    // A <span>, not an <a> — the whole row is already the link (below).
    // Nesting a real anchor inside it would be invalid HTML (interactive
    // content inside <a>) and would give keyboard/screen-reader users two
    // overlapping tab stops for the same destination. Per-row `name`, not a
    // literal "Open Cup Taster →" — found live in the browser while
    // verifying BTC's own row: this text was hardcoded, so BTC's row read
    // "Open Cup Taster →" too, pointing a visitor at the wrong format's
    // name for the exact link that's supposed to name its own destination.
    children.push(el('span', { className: 'petrol-format-link', text: `Open ${name} →` }));
  }

  const cells = [
    el('span', { className: 'petrol-format-index petrol-mono', text: index }),
    el('div', { className: 'petrol-format-main' }, children),
    el(
      'span',
      { className: 'petrol-format-status' },
      live ? [liveDot(), tag('Basic free', { solid: true })] : [tag('Soon')],
    ),
  ];

  const tagName = live ? 'a' : 'div';
  return el(tagName, { className: classes.join(' '), attrs: live ? { href } : {} }, cells);
}

function formatsSection() {
  const inner = el('div', { className: 'petrol-wrap', attrs: { id: 'formats' } }, [
    el('p', { className: 'petrol-eyebrow', text: '02 · The lineup' }),
    el('h2', { className: 'petrol-heading', text: 'Four formats. One platform. Zero installs.' }),
    el('p', {
      className: 'petrol-band-body',
      text:
        'Pure web, offline-resilient, projector-ready. An organiser opens a link and runs ' +
        'the whole competition from a tablet.',
    }),
    el('div', { className: 'petrol-format-list' }, [
      formatRow(
        '01',
        'Throwdown',
        '1v1 knockout — redemption & revival draw, live audience view. The format that ' +
          'launched the platform.',
        { dimmed: true },
      ),
      formatRow(
        '02',
        'Liga Seduh',
        'Round-robin league — auto-generated schedules, live standings, judged finals, ' +
          'season reports.',
        { dimmed: true },
      ),
      formatRow(
        '03',
        'Cup Taster',
        'Blind triangulation heats — find the odd cup. Stage advancement, tie detection, ' +
          'live right/wrong reveals.',
        { live: true, href: '/app/#/events' },
      ),
      formatRow(
        '04',
        'BTC',
        'Team head-to-head, cup-by-cup — round-robin prelims seed a full bracket, with ' +
          'standings and advancement handled automatically.',
        { live: true, href: '/app/#/events' },
      ),
    ]),
  ]);
  const section = el('section', { className: 'petrol-formats' }, [inner]);
  revealOnScroll(inner);
  return section;
}

const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LATEST_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// Reduces a public_results row to the three public facts the landing card shows, or null if the row
// is unusable. The payload is unvalidated jsonb, so every field is type-checked; nothing else (no
// competitor, no score) is read.
function latestEventFacts(row) {
  const payload = row?.payload;
  const name = typeof payload?.eventName === 'string' ? payload.eventName.trim() : '';
  if (!name || typeof row?.event_id !== 'string' || !EVENT_ID_PATTERN.test(row.event_id))
    return null;
  let date = null;
  if (typeof payload.eventDate === 'string' && ISO_DATE_PATTERN.test(payload.eventDate)) {
    const parsed = new Date(`${payload.eventDate}T00:00:00`);
    // A real calendar day only: `2026-02-30` would roll over to 2 March.
    const [y, m, d] = payload.eventDate.split('-').map(Number);
    if (parsed.getFullYear() === y && parsed.getMonth() + 1 === m && parsed.getDate() === d)
      date = LATEST_DATE_FORMAT.format(parsed);
  }
  return {
    name,
    date,
    // The same cleaning publishedOrgName (core/publicResults.js) applies; imported from orgLabel so the
    // landing bundle does not statically pull in the Supabase client.
    org: cleanOrgName(payload.org_name) || null,
    eventId: row.event_id,
  };
}

function latestEventBlock(facts) {
  const meta = [facts.date, facts.org ? `Organised by ${facts.org}` : null].filter(Boolean);
  return el('div', { className: 'petrol-story-latest' }, [
    el('p', { className: 'petrol-story-latest-label', text: 'Latest published result' }),
    el('p', { className: 'petrol-story-latest-name', text: facts.name }),
    ...(meta.length
      ? [el('p', { className: 'petrol-story-latest-meta', text: meta.join(' · ') })]
      : []),
    el('a', {
      className: 'petrol-story-latest-link',
      text: 'View results →',
      attrs: { href: `/results/?sheet=${encodeURIComponent(facts.eventId)}` },
    }),
  ]);
}

// The proof card's full-bleed background. Any image dropped in here is cropped with object-fit: cover, so
// `position` (CSS object-position) is the focal point that stays in frame, same idea as HERO_PHOTOS.
const STORY_PHOTO = {
  src: '/marketing/hero-cupping-bowls.jpg',
  alt: 'Cupping bowls lined up at Girls Got Drip Vol. 0',
  position: '50% 50%',
};

function proofSection(loadLatest) {
  const photo = el('img', {
    className: 'petrol-story-photo',
    attrs: { src: STORY_PHOTO.src, alt: STORY_PHOTO.alt, loading: 'lazy' },
  });
  photo.style.objectPosition = STORY_PHOTO.position;
  // The story spans the whole viewport (the photo is full bleed); the copy sits in the usual content wrap.
  const story = el('div', { className: 'petrol-story petrol-proof-inner' }, [
    photo,
    el('div', { className: 'petrol-wrap petrol-story-wrap' }, [
      el('div', { className: 'petrol-story-copy' }, [
        tag('Completed', { solid: true }),
        el('h2', { className: 'petrol-heading', text: 'Not a demo. Real events, real brackets.' }),
        el('p', {
          className: 'petrol-band-body',
          text:
            'Girls Got Drip Vol. 0 — &Coffee Bandar, June 2026. The first parallel test on a ' +
            'single Android tablet. What broke got fixed; what survived became the product.',
        }),
        el('p', { className: 'petrol-story-next', text: 'Next event — date to be announced.' }),
      ]),
    ]),
  ]);

  // The static story above is the whole card until (and unless) the newest published event arrives.
  // A slow, failed or empty answer changes nothing; a good one adds a block under the heading.
  if (loadLatest) {
    const copy = story.querySelector('.petrol-story-copy');
    loadLatest().then(
      (row) => {
        const facts = latestEventFacts(row);
        if (facts) copy.querySelector('.petrol-heading').after(latestEventBlock(facts));
      },
      () => {},
    );
  }

  const section = el('section', { className: 'petrol-proof' }, [story]);
  revealOnScroll(story);
  return section;
}

// The "live now" bar (2026-10-29). Absent from the static page and from the build-time prerender: it exists only
// when `loadLive` resolves with at least one listed live event, and is inserted ABOVE the nav, so a slow, failed
// or empty answer changes nothing at all. Rows come tidy and typed from core/publicLiveNow.js (the Supabase client
// stays out of this file's static imports); a row of a kind this page does not know is skipped, which is how a
// registration row can be added later. It does not auto-rotate, animate or flash: one sentence and one link.
function liveBar({ rows, total }) {
  const live = rows.filter((row) => row.kind === 'live');
  if (!live.length) return null;
  const [first, ...others] = live;
  const named = (row) => (row.orgName ? `${row.eventName} by ${row.orgName}` : row.eventName);
  const main = el('div', { className: 'petrol-live-bar-main' }, [
    el('span', { className: 'petrol-live-bar-dot', attrs: { 'aria-hidden': 'true' } }),
    el('p', { className: 'petrol-live-bar-text' }, [
      el('strong', { className: 'petrol-live-bar-label', text: 'Live now:' }),
      document.createTextNode(` ${named(first)}`),
    ]),
    el('a', {
      className: 'petrol-live-bar-link',
      text: 'Watch →',
      attrs: { href: first.href, 'aria-label': `Watch ${named(first)} live` },
    }),
  ]);
  const children = [main];
  // Everything past the first sits behind a disclosure so the bar stays one slim row.
  const all = Math.max(total, live.length);
  if (all > 1) {
    const panelId = 'petrol-live-bar-more';
    const toggle = el('button', {
      className: 'petrol-live-bar-more-toggle',
      text: `+${all - 1} more live`,
      attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
    });
    const unseen = all - live.length;
    const items = others.map((row) =>
      el('li', {}, [
        el('a', {
          className: 'petrol-live-bar-link',
          text: named(row),
          attrs: { href: row.href, 'aria-label': `Watch ${named(row)} live` },
        }),
      ]),
    );
    if (unseen > 0)
      items.push(
        el('li', { className: 'petrol-live-bar-rest', text: `and ${unseen} more live now` }),
      );
    const panel = el(
      'ul',
      { className: 'petrol-live-bar-more', id: panelId, attrs: { hidden: '' } },
      items,
    );
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    });
    main.appendChild(toggle);
    children.push(panel);
  }
  return el(
    'section',
    { className: 'petrol-live-bar', attrs: { 'aria-label': 'Live now' } },
    children,
  );
}

function pricingColumn(label, price, suffix, body, { featured = false } = {}) {
  const priceLine = [document.createTextNode(price)];
  if (suffix) priceLine.push(el('span', { className: 'petrol-price-suffix', text: suffix }));
  return el(
    'div',
    { className: `petrol-plate-col${featured ? ' petrol-plate-col-featured' : ''}` },
    [
      el('span', {
        className: `petrol-tier-label${featured ? ' petrol-tier-label-accent' : ''}`,
        text: label,
      }),
      el('div', { className: 'petrol-tier-price petrol-mono tabular-nums' }, priceLine),
      el('p', { className: 'petrol-band-body', text: body }),
    ],
  );
}

function pricingSection() {
  const inner = el('div', { className: 'petrol-wrap', attrs: { id: 'pricing' } }, [
    el('p', { className: 'petrol-eyebrow', text: '03 · Pricing, stated plainly' }),
    el('h2', { className: 'petrol-heading', text: 'Three tiers. Start free.' }),
    el('div', { className: 'petrol-plate' }, [
      pricingColumn(
        TIERS[0].name,
        TIERS[0].price,
        TIERS[0].suffix,
        'For organisers getting started. Up to 8 competitors, and one active event at a ' +
          'time. The podium is published to the public archive when the event ends.',
      ),
      pricingColumn(
        TIERS[1].name,
        TIERS[1].price,
        TIERS[1].suffix,
        'One event, in the format you choose, branded, with PDF reports. Pay once, run ' +
          'your event, done.',
        { featured: true },
      ),
      pricingColumn(
        TIERS[2].name,
        TIERS[2].price,
        TIERS[2].suffix,
        'For organisers running events all year. Every format and feature, with no ' +
          'competitor limit.',
      ),
    ]),
    el('p', {
      className: 'petrol-footnote',
      text: 'All prices in Brunei dollars · billed through Grey Matter Coffee Werks.',
    }),
    el('div', { className: 'petrol-pricing-more' }, [
      actionLink('Learn more: compare every tier →', { outline: true, href: '/pricing/' }),
    ]),
  ]);
  const section = el('section', { className: 'petrol-band', attrs: { id: 'pricing-band' } }, [
    inner,
  ]);
  revealOnScroll(inner);
  return section;
}

function ctaBand() {
  const photo = el('div', { className: 'petrol-cta-photo' }, [
    el('img', {
      attrs: { src: '/marketing/cta-pour.jpg', alt: '', loading: 'lazy' },
    }),
    el('div', { className: 'petrol-cta-accent', attrs: { 'aria-hidden': 'true' } }),
  ]);
  const copy = el('div', { className: 'petrol-cta-copy' }, [
    el('h2', {
      className: 'petrol-heading',
      text: 'The next champion is about to be written down.',
    }),
    el('div', { className: 'petrol-hero-actions' }, [
      actionLink('Start free — no account', { primary: true }),
      actionLink('Take the tour', { outline: true, href: '/tour/' }),
    ]),
  ]);
  const inner = el('div', { className: 'petrol-cta' }, [photo, copy]);
  revealOnScroll(inner);
  return inner;
}

// `loadLatest` (optional) resolves the newest public_results row or null; `loadLive` (optional) resolves
// `{ rows, total }` from core/publicLiveNow.js. Omitted, the page makes no request at all (tests, the
// build-time prerender).
export function mountLandingScreen(root, { loadLatest, loadLive } = {}) {
  const page = el('div', { className: 'petrol-page', attrs: { 'data-surface': 'stage' } }, [
    buildNav(),
    buildHero(),
    ticker(),
    problemSection(),
    formatsSection(),
    ticker(),
    proofSection(loadLatest),
    pricingSection(),
    ctaBand(),
    buildPublicFooter({
      companionHref: '/community/',
      companionText: 'Community Tools →',
    }),
  ]);
  root.replaceChildren(page);
  if (loadLive) {
    loadLive().then(
      (answer) => {
        const bar = liveBar(answer ?? { rows: [], total: 0 });
        if (bar && root.contains(page)) page.prepend(bar);
      },
      () => {},
    );
  }
}

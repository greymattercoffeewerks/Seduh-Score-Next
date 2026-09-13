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
//   - The fourth format is "BBTC" everywhere else in this codebase
//     (src/formats/bbtc/, ROADMAP.md) — the design reference called it
//     "BTC," which isn't this product's real name for it. Corrected here,
//     the same way an earlier rework corrected a fabricated nav link.
//   - The design reference hand-picked several one-off graphite/teal hex
//     values for backgrounds and text, entirely independent of the shared
//     token system (it predates the decision to import that system here).
//     Backgrounds close enough to an existing `--clr-petrol-*` ramp step
//     were snapped onto that step; text/accent colors on this page's dark
//     surfaces resolve via `data-surface="stage"` (the same mechanism the
//     console's projector view uses) rather than a hand-picked light-on-dark
//     hex — see landing.css for exactly where and why.
//
// Built with core/dom.js's el()/svgEl()/brandMark(), same as every console
// screen (textContent-only, no innerHTML — see dom.js's own header comment
// for why).
import { el, svgEl, brandMark } from '../core/dom.js';
import { revealOnScroll } from '../core/scrollReveal.js';
import { APP_VERSION } from '../core/version.js';

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

// "Take the tour" and "Org login" are href="#" placeholders (no tour page,
// no sign-up flow — loginScreen.js is sign-in only, D14's real access
// control is still a stub). "Formats"/"Pricing" are real same-page anchors.
// "Free Timer" is the one other real destination.
function navLink(text, href) {
  return el('a', { className: 'petrol-nav-link', text, attrs: { href } });
}

function actionLink(text, { primary = false, outline = false, href = '#' } = {}) {
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
  const mark = brandMark();
  mark.classList.add('petrol-brand-mark');
  mark.setAttribute('aria-hidden', 'true');

  const brand = el('div', { className: 'petrol-brand' }, [
    mark,
    el('span', { text: 'Seduh Score' }),
  ]);

  const live = el('span', { className: 'petrol-live-indicator' }, [
    liveDot(),
    document.createTextNode('Live — Cup Taster'),
  ]);

  const secondary = el('span', {
    className: 'petrol-secondary-label',
    text: 'No install · no wifi dependency',
  });

  const links = el('div', { className: 'petrol-nav-links' }, [
    navLink('Formats', '#formats'),
    navLink('Pricing', '#pricing'),
    navLink('Timer', '/tools/timer/'),
    navLink('Org login', '#'),
  ]);
  const desktopCta = actionLink('Start free', { primary: true });
  const desktopGroup = el('div', { className: 'petrol-nav-desktop' }, [links, desktopCta]);

  const mobileLinks = el('div', { className: 'petrol-nav-mobile-links' }, [
    navLink('Formats', '#formats'),
    navLink('Pricing', '#pricing'),
    navLink('Timer', '/tools/timer/'),
    navLink('Org login', '#'),
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

// Four rotating full-bleed photos, crossfading on a timer — purely
// atmospheric (no caption claims a specific real event), so alt text stays
// empty and the whole strip is aria-hidden; the headline/body copy right
// next to it carries the actual message. Auto-advance is skipped entirely
// under prefers-reduced-motion (the dots still work, for a visitor who
// wants to look at a specific photo) rather than fighting a suppressed CSS
// transition with a class toggle that has nowhere to animate to.
const HERO_PHOTOS = [
  { src: '/marketing/hero-tablet.jpg', alt: '' },
  { src: '/marketing/hero-projector.jpg', alt: '' },
  { src: '/marketing/petrol-hero-cupping-bowls.jpg', alt: '' },
  { src: '/marketing/hero-bracket.jpg', alt: '' },
];
const HERO_INTERVAL_MS = 4200;

function buildHeroPhotos() {
  const frames = HERO_PHOTOS.map(({ src, alt }, i) =>
    el('img', {
      className: `petrol-hero-photo${i === 0 ? ' petrol-hero-photo-active' : ''}`,
      attrs: { src, alt, loading: i === 0 ? 'eager' : 'lazy' },
    }),
  );
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
      actionLink('Take the tour', { outline: true }),
    ]),
    el('div', { className: 'petrol-stat-strip' }, [
      statItem('1', 'format live'),
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

// Cup Taster is the one real, live format — not dimmed, left-accented, and
// its own row is a link straight into the app. The other three are real
// product scope (ROADMAP.md), just not built yet, so they're dimmed rather
// than equal-weight with Cup Taster. "BBTC," not "BTC" — see this file's
// header comment for why that's a correction, not a typo carried over.
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
    // overlapping tab stops for the same destination.
    children.push(el('span', { className: 'petrol-format-link', text: 'Open Cup Taster →' }));
  }

  const cells = [
    el('span', { className: 'petrol-format-index petrol-mono', text: index }),
    el('div', {}, children),
    live
      ? el('span', { className: 'petrol-format-status' }, [
          liveDot(),
          tag('Basic free', { solid: true }),
        ])
      : tag('Soon'),
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
        'BBTC',
        'Barista Team Championship — the flagship team format, with branded PDF reporting ' +
          'piloted here first.',
        { dimmed: true },
      ),
    ]),
  ]);
  const section = el('section', { className: 'petrol-formats' }, [inner]);
  revealOnScroll(inner);
  return section;
}

function fact(value, copy, accent = false) {
  return el('article', { className: `petrol-fact${accent ? ' petrol-fact-accent' : ''}` }, [
    el('b', { className: 'petrol-mono tabular-nums', text: value }),
    el('p', { text: copy }),
  ]);
}

function proofSection() {
  const facts = el('div', { className: 'petrol-proof-facts' }, [
    fact('0', 'installs. Pure web, open it on the day.'),
    fact('1', 'event flow: setup, roster, stages, then heats.'),
    fact('3', 'live surfaces: splash screen, projector, and phone.'),
    fact('1', 'format live today: Cup Taster. More are coming.', true),
  ]);

  const story = el('div', { className: 'petrol-story' }, [
    el('img', {
      className: 'petrol-story-photo',
      attrs: { src: '/marketing/hero-cupping-bowls.jpg', alt: '', loading: 'lazy' },
    }),
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
  ]);

  const inner = el('div', { className: 'petrol-wrap petrol-proof-inner' }, [facts, story]);
  const section = el('section', { className: 'petrol-proof' }, [inner]);
  revealOnScroll(inner);
  return section;
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
    el('p', { className: 'petrol-eyebrow', text: '04 · Pricing, stated plainly' }),
    el('h2', { className: 'petrol-heading', text: 'Three tiers. No access gate.' }),
    el('div', { className: 'petrol-plate' }, [
      pricingColumn(
        'Community',
        'Free',
        null,
        'Full platform, unbranded, for organisers just getting started. No account needed ' +
          'to run a small event.',
      ),
      pricingColumn(
        'Per-event',
        'BND $18',
        'one-time',
        'One competition, fully branded, PDF reports included. Pay once, run your event, ' +
          'done.',
        { featured: true },
      ),
      pricingColumn(
        'Annual',
        'BND $100',
        'per year',
        'Every format including BBTC, priced for organisers running events all year. ' +
          'Persistent history across seasons.',
      ),
    ]),
    el('p', {
      className: 'petrol-footnote',
      text: 'All prices in Brunei dollars · billed through Grey Matter Coffee Werks.',
    }),
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
      text: 'The next champion is about to be written down — permanently.',
    }),
    el('div', { className: 'petrol-hero-actions' }, [
      actionLink('Start free — no account', { primary: true }),
      actionLink('Take the tour', { outline: true }),
    ]),
  ]);
  const inner = el('div', { className: 'petrol-cta' }, [photo, copy]);
  revealOnScroll(inner);
  return inner;
}

function buildFooter() {
  return el('footer', { className: 'petrol-footer petrol-mono' }, [
    el('span', { text: 'Built by Firdaus Omar · Grey Matter Coffee Werks, Brunei' }),
    el('div', { className: 'petrol-footer-links' }, [
      el('a', {
        className: 'petrol-footer-link',
        text: 'Free Timer — saves to this device →',
        attrs: { href: '/tools/timer/' },
      }),
      el('a', {
        className: 'petrol-version',
        text: `v${APP_VERSION}`,
        attrs: { href: '/bts/' },
      }),
    ]),
  ]);
}

export function mountLandingScreen(root) {
  root.replaceChildren(
    el('div', { className: 'petrol-page', attrs: { 'data-surface': 'stage' } }, [
      buildNav(),
      buildHero(),
      ticker(),
      problemSection(),
      formatsSection(),
      ticker(),
      proofSection(),
      pricingSection(),
      ctaBand(),
      el('div', { className: 'petrol-wrap' }, [buildFooter()]),
    ]),
  );
}

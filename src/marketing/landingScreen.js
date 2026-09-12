// Marketing landing page — Seduh Score Next.
//
// Built with core/dom.js's el()/svgEl()/brandMark(), same as every console
// screen, not raw HTML strings — this page ships real copy and needs the
// same "never trust interpolated data as markup" discipline dom.js's own
// header comment states, even though nothing here is currently
// user-entered. Content and structure carried over from the design
// exploration (design/landing-page/Main.dc.html + EditorialNights.dc.html,
// 2026-09-07); this is that same page rebuilt as production code — one
// file behind a `data-theme` attribute instead of two static mockups.
import { el, svgEl, brandMark } from '../core/dom.js';
import { APP_VERSION } from '../core/version.js';
import { initTheme } from './theme.js';

function icon(children) {
  const svg = svgEl('svg', { class: 'landing-icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  svg.append(...children);
  return svg;
}

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
  coffee: () =>
    icon([
      svgEl('path', { d: 'M17 8h1a4 4 0 1 1 0 8h-1' }),
      svgEl('path', { d: 'M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z' }),
      svgEl('line', { x1: '6', y1: '1', x2: '6', y2: '4' }),
      svgEl('line', { x1: '10', y1: '1', x2: '10', y2: '4' }),
      svgEl('line', { x1: '14', y1: '1', x2: '14', y2: '4' }),
    ]),
  users: () =>
    icon([
      svgEl('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
      svgEl('circle', { cx: '9', cy: '7', r: '4' }),
      svgEl('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
      svgEl('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }),
    ]),
  sun: () =>
    icon([
      svgEl('circle', { cx: '12', cy: '12', r: '4' }),
      svgEl('line', { x1: '12', y1: '2', x2: '12', y2: '4' }),
      svgEl('line', { x1: '12', y1: '20', x2: '12', y2: '22' }),
      svgEl('line', { x1: '4.2', y1: '4.2', x2: '5.6', y2: '5.6' }),
      svgEl('line', { x1: '18.4', y1: '18.4', x2: '19.8', y2: '19.8' }),
      svgEl('line', { x1: '2', y1: '12', x2: '4', y2: '12' }),
      svgEl('line', { x1: '20', y1: '12', x2: '22', y2: '12' }),
      svgEl('line', { x1: '4.2', y1: '19.8', x2: '5.6', y2: '18.4' }),
      svgEl('line', { x1: '18.4', y1: '5.6', x2: '19.8', y2: '4.2' }),
    ]),
  moon: () => icon([svgEl('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' })]),
};

function buildBloom() {
  return el('div', { className: 'landing-bloom', attrs: { 'aria-hidden': 'true' } }, [
    el('span'),
    el('span'),
    el('span'),
  ]);
}

// Randomized once per page load (position/drift/duration/delay), same
// generation shape as the design exploration's Component.renderVals() —
// ported to plain JS now that this is real app code, not a Design
// Component template.
function buildSteamField(count = 14) {
  const field = el('div', {
    className: 'landing-steam-field',
    attrs: { 'aria-hidden': 'true' },
  });
  for (let i = 0; i < count; i += 1) {
    const size = 2 + Math.random() * 3;
    const left = Math.random() * 100;
    const drift = Math.random() * 70 - 35;
    const duration = 12 + Math.random() * 6;
    const delay = Math.random() * 10;
    const particle = el('span', { className: 'landing-steam-p' });
    particle.style.left = `${left.toFixed(2)}%`;
    particle.style.setProperty('--drift', `${drift.toFixed(2)}px`);
    particle.style.width = `${size.toFixed(2)}px`;
    particle.style.height = `${size.toFixed(2)}px`;
    particle.style.animationDuration = `${duration.toFixed(2)}s`;
    particle.style.animationDelay = `${delay.toFixed(2)}s`;
    field.appendChild(particle);
  }
  return field;
}

function updateThemeToggleIcon(button) {
  const isNight = document.documentElement.dataset.theme === 'night';
  button.replaceChildren(isNight ? ICONS.sun() : ICONS.moon());
}

// "Tour", "Pricing", "Org login", and every "Start free"/"Take the tour"
// CTA are href="#" placeholders (found in review, code-reviewer, flagged as
// dead links). Real destinations don't exist yet — there's no tour page,
// no pricing anchor/page, no sign-up flow (loginScreen.js is sign-in only,
// D14's real access control is still a stub), and "/app/" requires an
// account this page doesn't offer a way to create. Left as "#" rather than
// silently pointed somewhere wrong; wiring these up is follow-on work once
// those destinations exist, not a gap in this page's own build.

function buildNav() {
  const markWrap = el('span', { className: 'landing-brand-mark-wrap' });
  const mark = brandMark();
  mark.classList.add('landing-brand-mark');
  // brandMark() sets role="img"/aria-label="Seduh" for call sites where it
  // stands alone; here it sits right next to the visible "Seduh Score"
  // text, so a screen reader would announce the name twice back to back —
  // hide the icon itself instead (found in review, ui-accessibility-reviewer).
  mark.setAttribute('aria-hidden', 'true');
  markWrap.appendChild(mark);

  const brand = el('div', { className: 'landing-nav-brand' }, [
    markWrap,
    el('span', { className: 'landing-brand-name', text: 'Seduh Score' }),
  ]);

  const navPanel = el('div', { className: 'landing-nav-panel', id: 'landing-nav-panel' }, [
    el('a', { className: 'landing-nav-link', text: 'Tour', attrs: { href: '#' } }),
    el('a', { className: 'landing-nav-link', text: 'Pricing', attrs: { href: '#' } }),
    // The one real, working destination in this nav besides the format
    // card below — a free standalone tool (src/tools/timer/), deliberate
    // promotion for the product (user decision, 2026-09-12).
    el('a', { className: 'landing-nav-link', text: 'Free Timer', attrs: { href: '/tools/timer/' } }),
    el('a', { className: 'landing-nav-link', text: 'Org login', attrs: { href: '#' } }),
    el('a', {
      className: 'landing-btn landing-btn-primary',
      text: 'Start free',
      attrs: { href: '#' },
    }),
  ]);

  const navToggle = el('button', {
    className: 'landing-nav-toggle tap-target',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'landing-nav-panel',
      'aria-label': 'Menu',
    },
  });
  navToggle.append(
    el('span', { className: 'landing-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'landing-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'landing-nav-toggle-bar', attrs: { 'aria-hidden': 'true' } }),
  );

  function closeMenu() {
    navPanel.classList.remove('landing-nav-panel-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
  navToggle.addEventListener('click', () => {
    const open = navPanel.classList.toggle('landing-nav-panel-open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  navToggle.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  navPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      navToggle.focus();
    }
  });
  navPanel.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  const themeToggle = el('button', {
    className: 'landing-theme-toggle tap-target',
    attrs: { type: 'button', 'aria-label': 'Switch between day and night theme' },
  });

  const navRight = el('div', { className: 'landing-nav-right' }, [
    navPanel,
    themeToggle,
    navToggle,
  ]);

  const nav = el('nav', { className: 'landing-nav', attrs: { 'aria-label': 'Primary' } }, [
    el('div', { className: 'landing-wrap' }, [
      el('div', { className: 'landing-nav-row' }, [brand, navRight]),
    ]),
  ]);

  return { nav, themeToggle };
}

function buildStat(num, label) {
  return el('div', { className: 'landing-stat-cell' }, [
    el('div', { className: 'landing-mono landing-stat-num', text: String(num) }),
    el('div', { className: 'landing-stat-label', text: label }),
  ]);
}

// Full-bleed photo hero — the big, dominant first-screen moment: headline,
// sub, CTAs, and the stat strip all overlay a single large photo, and
// everything else on the page (problem, formats, proof, pricing) only
// appears once a visitor scrolls past it. Same "photo + dark scrim +
// centered content" pattern as buildFinalCta()'s section at the bottom of
// the page, reused here rather than invented twice, so the two big photo
// moments bookend the page with one visual language.
function buildHero() {
  const copy = el('div', { className: 'landing-hero-content' }, [
    el('p', {
      className: 'landing-eyebrow landing-hero-eyebrow',
      text: 'Grey Matter Coffee Werks · Brunei',
    }),
    el('h1', { className: 'landing-hero-headline' }, [
      document.createTextNode('One tablet. One projector.'),
      el('br'),
      document.createTextNode('A competition that '),
      el('span', { className: 'landing-accent-text', text: "doesn't fall apart." }),
    ]),
    el('p', {
      className: 'landing-hero-sub',
      text:
        'Seduh Score runs the whole event — brackets, judging, live results — with no ' +
        'install and no dependency on venue wifi. Built for how Southeast Asian organisers ' +
        'actually run events.',
    }),
    el('div', { className: 'landing-hero-ctas' }, [
      el('a', {
        className: 'landing-btn landing-btn-primary',
        text: 'Start free — no account',
        attrs: { href: '#' },
      }),
      el('a', {
        className: 'landing-btn landing-btn-ghost',
        text: 'Take the tour',
        attrs: { href: '#' },
      }),
    ]),
    el('div', { className: 'landing-stat-strip' }, [
      buildStat(1, 'format live today'),
      buildStat(0, 'installs — pure web'),
      buildStat(1, 'tablet + projector runs it'),
      buildStat(3, 'pricing tiers, all public'),
    ]),
  ]);

  return el('div', { className: 'landing-hero' }, [
    buildHeroSlideshow(),
    el('div', { className: 'landing-hero-overlay', attrs: { 'aria-hidden': 'true' } }),
    buildBloom(),
    buildSteamField(),
    el('div', { className: 'landing-wrap' }, [copy]),
  ]);
}

// Hero slideshow — a slow, soft crossfade between a small set of photos,
// not a carousel (no arrows/dots/user control; this is ambient background,
// not content someone navigates). Ordered to loosely follow the hero's own
// pitch ("one tablet, one projector"): cupping → the tablet doing the
// scoring → a bracket being drawn → the projector moment → the pour shot
// also used in buildFinalCta(). Designed to take more without any code
// change — just add paths here. Respects prefers-reduced-motion by never
// starting the interval, same discipline as buildBloom()/
// buildSteamField()'s own CSS-level reduced-motion handling — the first
// photo stays put instead of cycling.
const HERO_PHOTOS = [
  '/marketing/hero-cupping-bowls.jpg',
  '/marketing/hero-cupping.jpg',
  '/marketing/hero-tablet.jpg',
  '/marketing/hero-bracket.jpg',
  '/marketing/hero-projector.jpg',
  '/marketing/cta-pour.jpg',
];

function buildHeroSlideshow() {
  const layer = el('div', { className: 'landing-hero-slideshow' });
  const images = HERO_PHOTOS.map((src, i) =>
    el('img', {
      className: `landing-hero-photo${i === 0 ? ' is-active' : ''}`,
      attrs: { src, alt: '', loading: i === 0 ? 'eager' : 'lazy' },
    }),
  );
  layer.append(...images);

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion && images.length > 1) {
    let active = 0;
    setInterval(() => {
      const next = (active + 1) % images.length;
      images[active].classList.remove('is-active');
      images[next].classList.add('is-active');
      active = next;
    }, 7000);
  }

  return layer;
}

function buildProblemCard(iconFn, title, body) {
  return el('div', { className: 'landing-card' }, [
    iconFn(),
    el('h3', { text: title }),
    el('p', { text: body }),
  ]);
}

function buildProblem() {
  const grid = el('div', { className: 'landing-problem-grid' }, [
    buildProblemCard(
      ICONS.alertTriangle,
      'Scattered scoring',
      "Slips, group chats and three half-open apps — no single source of truth for who's winning.",
    ),
    buildProblemCard(
      ICONS.laptop,
      'One fragile laptop',
      'The whole event on one spreadsheet, one person, one point of failure.',
    ),
    buildProblemCard(
      ICONS.wifiOff,
      'Venue wifi',
      'A live run that hangs on a connection which never quite holds through the finals.',
    ),
    buildProblemCard(
      ICONS.trash,
      'Gone afterward',
      "Every result deleted once the trophy's handed out. No record, no history, no proof.",
    ),
  ]);

  return el('div', { className: 'landing-section landing-section-sunken' }, [
    el('div', { className: 'landing-wrap' }, [
      el('p', { className: 'landing-eyebrow', text: 'The problem' }),
      el('h2', {
        className: 'landing-section-heading landing-problem-heading',
        text: 'Right now, the whole competition rides on one laptop and a group chat.',
      }),
      el('p', {
        className: 'landing-section-lede',
        text:
          'A bracket taped to the wall. Scores called out and typed into a spreadsheet one ' +
          "person guards. The wifi drops and the room waits. A result gets questioned and there's " +
          'nothing to point to. Then it ends — and the whole thing is wiped to make room for ' +
          'the next one.',
      }),
      grid,
    ]),
  ]);
}

function buildFormatCard({ iconFn, title, body, status }) {
  const head = el('div', { className: 'landing-format-head' }, [iconFn()]);

  if (status.kind === 'live') {
    head.appendChild(
      el('span', { className: 'landing-format-live-status' }, [
        el('span', {
          className: 'status-live-dot',
          attrs: { 'aria-hidden': 'true' },
        }),
        el('span', { className: 'landing-badge landing-badge-live', text: status.label }),
      ]),
    );
    const card = el(
      'a',
      {
        className: 'landing-card landing-format-card landing-format-live',
        attrs: { href: status.href },
      },
      [
        head,
        el('h3', { text: title }),
        el('p', { text: body }),
        el('span', { className: 'landing-format-open', text: status.cta }),
      ],
    );
    return card;
  }

  head.appendChild(
    el('span', { className: 'landing-badge landing-badge-soon', text: 'Coming soon' }),
  );
  return el('div', { className: 'landing-card landing-format-card landing-format-disabled' }, [
    head,
    el('h3', { text: title }),
    el('p', { text: body }),
  ]);
}

function buildFormats() {
  const grid = el('div', { className: 'landing-format-grid' }, [
    buildFormatCard({
      iconFn: ICONS.zap,
      title: 'Throwdown',
      body:
        '1v1 knockout — redemption & revival draw, live audience view. The format that ' +
        'launched the platform.',
      status: { kind: 'soon' },
    }),
    buildFormatCard({
      iconFn: ICONS.trophy,
      title: 'Liga Seduh',
      body:
        'Round-robin league — auto-generated schedules, live standings, judged finals, ' +
        'season reports.',
      status: { kind: 'soon' },
    }),
    buildFormatCard({
      iconFn: ICONS.coffee,
      title: 'Cup Taster',
      body:
        'Blind triangulation heats — find the odd cup. Stage advancement, tie detection, ' +
        'live right/wrong reveals.',
      status: {
        kind: 'live',
        label: 'Basic free',
        href: '/app/#/events',
        cta: 'Open Cup Taster →',
      },
    }),
    buildFormatCard({
      iconFn: ICONS.users,
      title: 'BTC',
      body:
        'Barista Team Championship — the flagship team format, with branded PDF reporting ' +
        'piloted here first.',
      status: { kind: 'soon' },
    }),
  ]);

  return el('div', { className: 'landing-wrap landing-section' }, [
    el('p', { className: 'landing-eyebrow', text: "The product · what's in the cup" }),
    el('h2', {
      className: 'landing-section-heading',
      text: 'Four formats. One platform. Zero installs.',
    }),
    el('p', {
      className: 'landing-section-lede',
      text:
        'Pure web, offline-resilient, projector-ready. An organiser opens a link, runs an ' +
        'entire competition from a tablet, and the audience watches results land in real time.',
    }),
    grid,
  ]);
}

function buildProof() {
  const card = el('div', { className: 'landing-card landing-proof-card' }, [
    el('div', { className: 'landing-proof-row' }, [
      el('span', { className: 'landing-proof-name', text: 'Girls Got Drip Vol. 0' }),
      el('span', { className: 'landing-badge landing-badge-live', text: 'Completed' }),
    ]),
    el('div', { className: 'landing-proof-row' }, [
      el('p', {
        className: 'landing-proof-desc',
        text:
          '&Coffee Bandar · June 2026 — the first parallel test on a single Android ' +
          'tablet. What broke got fixed; what survived became the product.',
      }),
    ]),
    el('div', { className: 'landing-proof-row' }, [
      el('span', {
        className: 'landing-proof-next',
        text: '[ next event — date to be announced ]',
      }),
    ]),
  ]);

  return el('div', { className: 'landing-section landing-section-sunken' }, [
    el('div', { className: 'landing-wrap landing-proof-grid' }, [
      el('div', {}, [
        el('p', { className: 'landing-eyebrow', text: 'Proof' }),
        el('h2', {
          className: 'landing-section-heading',
          text: 'Not a demo. Real events, real brackets.',
        }),
        el('p', {
          className: 'landing-section-lede',
          text:
            'Every competition run on Seduh Score keeps its results — each one gets its ' +
            'own archived page. Proof that outlives the trophy.',
        }),
      ]),
      card,
    ]),
  ]);
}

function buildPricingCard({ tier, tierClass, price, period, body, borderStrong }) {
  const cardClass = borderStrong
    ? 'landing-card landing-pricing-card landing-pricing-card-featured'
    : 'landing-card landing-pricing-card';
  const card = el('div', { className: cardClass });
  const badgeClass = tierClass
    ? `landing-badge ${tierClass}`
    : 'landing-badge landing-badge-neutral';
  card.appendChild(el('span', { className: badgeClass, text: tier }));
  card.appendChild(el('div', { className: 'landing-mono landing-price', text: price }));
  if (period) card.appendChild(el('div', { className: 'landing-price-period', text: period }));
  card.appendChild(el('p', { text: body }));
  return card;
}

function buildPricing() {
  const grid = el('div', { className: 'landing-pricing-grid' }, [
    buildPricingCard({
      tier: 'Community',
      tierClass: '',
      price: 'Free',
      body:
        'Full platform, unbranded, for organisers just getting started. No account needed ' +
        'to run a small event.',
    }),
    buildPricingCard({
      tier: 'Per-event',
      tierClass: 'landing-badge-live',
      price: 'BND $18',
      period: 'one-time',
      body: 'One competition, fully branded, PDF reports included. Pay once, run your event, done.',
      borderStrong: true,
    }),
    buildPricingCard({
      tier: 'Full platform · annual',
      tierClass: 'landing-badge-annual',
      price: 'BND $100',
      period: 'per year',
      body:
        'Every format including BTC, priced for organisers running events all year. ' +
        'Persistent history across seasons.',
    }),
  ]);

  return el('div', { className: 'landing-wrap landing-section' }, [
    el('p', { className: 'landing-eyebrow', text: 'Pricing, stated plainly' }),
    el('h2', { className: 'landing-section-heading', text: 'Three tiers. No access gate.' }),
    el('p', {
      className: 'landing-section-lede',
      text:
        'Start free, pay for one event, or run the whole year. Every price is on this page ' +
        '— nothing to request, nothing to unlock.',
    }),
    grid,
    el('p', {
      className: 'landing-pricing-note',
      text: 'All prices in Brunei dollars · billed through Grey Matter Coffee Werks.',
    }),
  ]);
}

function buildFinalCta() {
  return el('div', { className: 'landing-cta' }, [
    el('img', {
      className: 'landing-cta-photo',
      attrs: { src: '/marketing/cta-pour.jpg', alt: '', loading: 'lazy' },
    }),
    el('div', { className: 'landing-cta-overlay' }),
    el('div', { className: 'landing-wrap landing-cta-inner' }, [
      el('h2', {
        className: 'landing-cta-heading',
        text: 'The next champion is about to be written down — permanently.',
      }),
      el('div', { className: 'landing-cta-actions' }, [
        el('a', {
          className: 'landing-btn landing-cta-btn-primary',
          text: 'Start free — no account',
          attrs: { href: '#' },
        }),
        el('a', {
          className: 'landing-btn landing-cta-btn-ghost',
          text: 'Take the tour',
          attrs: { href: '#' },
        }),
      ]),
    ]),
  ]);
}

function buildFooter() {
  return el('div', { className: 'landing-wrap landing-footer' }, [
    el('span', {
      className: 'landing-footer-text',
      text: 'Built by Firdaus Omar · Grey Matter Coffee Werks, Brunei',
    }),
    el('div', { className: 'landing-footer-right' }, [
      el('a', {
        className: 'landing-footer-text landing-footer-link',
        text: 'Free Timer tool — saves to this device →',
        attrs: { href: '/tools/timer/' },
      }),
      el('a', {
        className: 'landing-mono landing-badge landing-version-pill',
        attrs: { href: '/bts/' },
        text: `v${APP_VERSION}`,
      }),
    ]),
  ]);
}

export function mountLandingScreen(root) {
  const { nav, themeToggle } = buildNav();

  root.append(
    nav,
    buildHero(),
    buildProblem(),
    buildFormats(),
    buildProof(),
    buildPricing(),
    buildFinalCta(),
    buildFooter(),
  );

  initTheme(themeToggle);
  updateThemeToggleIcon(themeToggle);
  themeToggle.addEventListener('click', () => updateThemeToggleIcon(themeToggle));
}

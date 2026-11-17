// Seduh ID person page (Layer 2, T-ID2.C1): /id/<handle>/. One shell serves every handle (worker/index.js); this reads
// the handle from the path and asks the ONE anonymous door, public.public_seduh_profile (core/seduhProfile.js), which has
// already applied the person's privacy settings in SQL. The page draws only what the door returns and invents no stat.
//
// A stranger must learn nothing from the page about WHY there is none: an unknown, closed, merged, opted-out or reserved
// handle all answer has_profile false and all draw the same "No Seduh ID here" page.
//
// Design basis: the owner-approved concept (design/seduh-id-layer2-concept.html, "A person"), built on the country pages'
// patterns (gold best-result card, compact stats row, native <details>). Every state is designed: loading, a failed read
// (with Try again, which moves focus to the heading), no page, a page whose parts are all hidden, a claimed person with
// no results yet, and the full page. Text goes in through textContent only (el()).
//
// Not built yet, on purpose, each a marked seam:
//   - SEAM C3: "Share to story" (the person story card; core/storyCard.js is ready for a person spec).
//   - SEAM C5: links INTO profiles (discovery). Nothing here links to another profile.
import { el } from '../core/dom.js';
import { countryName } from '../core/country.js';
import { buildCountryChip } from '../core/countryChip.js';
import { fetchSeduhProfile, handleFromPath, photoSrc } from '../core/seduhProfile.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import { buildPublicFooter } from './publicFooter.js';
import { buildPublicHeader } from './publicHeader.js';
import { CONTACT_EMAIL } from './trustContent.js';
import {
  KIND_LABELS,
  bestDetail,
  bestResult,
  computeStats,
  dateText,
  filterEntries,
  foundingText,
  groupByYear,
  hasSelfReported,
  initialsOf,
  kindsPresent,
  knockoutText,
  metaText,
  ordinal,
  placeText,
  provenanceLabels,
  summaryLine,
} from './profileFormat.js';

const KICKER = 'Seduh Score / Seduh ID';

// ---- shell and states ----

function pageShell(root, ...children) {
  root.replaceChildren(
    // The header and footer sit beside <main>, not inside it, so they are the page's banner and contentinfo landmarks.
    el('div', { className: 'profile-page', attrs: { 'data-surface': 'stage' } }, [
      buildPublicHeader({}),
      el('main', {}, children.filter(Boolean)),
      buildPublicFooter({ companionHref: '/', companionText: 'Back to Seduh Score →' }),
    ]),
  );
}

function plainHero({ title, intro, titleId = 'profile-title' }) {
  return el(
    'section',
    { className: 'profile-hero page-hero', attrs: { 'aria-labelledby': titleId } },
    [
      el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'page-hero-kicker', text: KICKER }),
      el('h1', { id: titleId, attrs: { tabindex: '-1' }, text: title }),
      intro ? el('p', { className: 'page-hero-intro', text: intro }) : null,
    ].filter(Boolean),
  );
}

function stateCard({ title, message, actions = [], role = 'status' }) {
  return el('section', { className: 'profile-body profile-state' }, [
    el(
      'div',
      { className: 'profile-state-card panel', attrs: { role } },
      [
        el('h2', { text: title }),
        el('p', { text: message }),
        actions.length ? el('div', { className: 'profile-state-actions' }, actions) : null,
      ].filter(Boolean),
    ),
  ]);
}

function failureCard(err, retry) {
  const text = err?.timedOut
    ? 'This is taking longer than expected. Check your connection and try again.'
    : 'Something went wrong loading this page. Please try again.';
  const button = el('button', {
    className: 'action action-primary',
    text: 'Try again',
    attrs: { type: 'button' },
  });
  // The button is replaced by the loading card, so focus would fall to the page: after the new state is drawn it goes
  // to the page's heading, where a keyboard or screen-reader user starts reading.
  button.addEventListener('click', () =>
    Promise.resolve(retry()).then(() => document.querySelector('.profile-page h1')?.focus()),
  );
  return stateCard({
    title: 'Could not load this page',
    message: text,
    role: 'alert',
    actions: [button],
  });
}

// What a stranger sees for every handle without a page. It says nothing about why, and never repeats the handle.
function noProfilePage(root) {
  document.title = 'No Seduh ID here — Seduh Score';
  pageShell(
    root,
    plainHero({ title: 'No Seduh ID here.' }),
    stateCard({
      title: 'There is no Seduh ID at this address',
      message: 'Check the link, or ask the person for their Seduh ID address.',
      actions: [
        el('a', {
          className: 'action action-outline',
          text: 'Back to Seduh Score',
          attrs: { href: '/' },
        }),
      ],
    }),
  );
}

// A claimed page whose every part the person has hidden: the page exists (a printed QR code never breaks) and says
// only that.
function privatePage(root, profile) {
  document.title = 'Seduh ID — Seduh Score';
  pageShell(
    root,
    plainHero({ title: profile.handle }),
    stateCard({
      title: 'This person keeps their Seduh ID private',
      message: 'They have chosen not to show anything on this page.',
    }),
    correctionNote(profile),
  );
}

// ---- footer note: whose record this is, what is never shown, and how to ask for a correction ----

function correctionNote(profile) {
  const who = profile.identity?.displayName ?? profile.handle;
  const subject = encodeURIComponent(`Seduh ID correction: ${profile.handle}`);
  return el(
    'section',
    { className: 'profile-body profile-note', attrs: { 'aria-labelledby': 'profile-note-title' } },
    [
      el('h2', {
        id: 'profile-note-title',
        className: 'profile-section-title',
        text: 'About this record',
      }),
      el('p', {
        text: `This record belongs to ${who}. Results marked “Recorded by Seduh Score” were produced by Seduh Score at the event.`,
      }),
      el('p', { text: 'Phone number and email are never shown.' }),
      el('p', {}, [
        document.createTextNode('To ask for a correction, write to '),
        el('a', {
          text: CONTACT_EMAIL,
          attrs: { href: `mailto:${CONTACT_EMAIL}?subject=${subject}` },
        }),
        document.createTextNode('. We acknowledge within 10 days and finish within 30.'),
      ]),
    ],
  );
}

// ---- the full page ----

// The avatar: the person's photo when the door sent one (T-ID2.C2, drawn only from the one accepted relative shape on this project's
// own Supabase address), else the initials. A photo that fails to load, or is hidden, is replaced by the initials; the alt text is
// "Photo of <name>". The initials are decoration (the name is the h1 beside them).
function initialsAvatar(name) {
  return el('span', {
    className: 'profile-avatar',
    attrs: { 'aria-hidden': 'true' },
    text: initialsOf(name),
  });
}

function avatar(name, src, onFailed) {
  if (!src) return initialsAvatar(name);
  const img = el('img', {
    className: 'profile-avatar profile-avatar-photo',
    attrs: { src, alt: `Photo of ${name}`, width: '512', height: '512', decoding: 'async' },
  });
  img.addEventListener(
    'error',
    () => {
      img.replaceWith(initialsAvatar(name));
      onFailed?.();
    },
    { once: true },
  );
  return img;
}

// "Report this photo": a mailto with the handle in the subject, the address also shown as text (a person without a mail app can copy it).
function reportPhoto(handle) {
  const subject = encodeURIComponent(`Report a Seduh ID photo: ${handle}`);
  return el('p', { className: 'profile-report' }, [
    el('a', {
      className: 'profile-report-link',
      text: 'Report this photo',
      attrs: { href: `mailto:${CONTACT_EMAIL}?subject=${subject}` },
    }),
    document.createTextNode(` · ${CONTACT_EMAIL}`),
  ]);
}

function countryNode(code, { linkCountry }) {
  const name = countryName(code) ?? code;
  // buildCountryChip is null while the country pages are not public (core/countryPages.js COUNTRY_PAGES_PUBLIC):
  // then the country is plain text and links nowhere.
  const link = buildCountryChip(code, { enabled: linkCountry });
  const label = `${code} · ${name}`;
  return el(
    'li',
    { className: 'tag' },
    link ? [link, document.createTextNode(` ${label}`)] : [document.createTextNode(label)],
  );
}

function heroFull(profile, options) {
  const { identity, handle } = profile;
  const name = identity?.displayName ?? handle;
  const founding = foundingText(identity?.foundingNumber ?? null);
  const chips = [
    founding
      ? el('li', {
          className: 'tag profile-founding',
          text: `Seduh ID #${founding}`,
          attrs: { title: 'Assigned when the page was claimed; never reissued' },
        })
      : null,
    identity?.countryCode ? countryNode(identity.countryCode, options) : null,
  ].filter(Boolean);
  const src = photoSrc(
    identity?.photoUrl ?? null,
    options.supabaseUrl ?? import.meta.env?.VITE_SUPABASE_URL,
  );
  const report = src ? reportPhoto(handle) : null;
  return el(
    'section',
    {
      className: 'profile-hero page-hero profile-hero-one',
      attrs: { 'aria-labelledby': 'profile-title' },
    },
    [
      el('div', { className: 'page-hero-grid', attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'page-hero-kicker', text: KICKER }),
      el('div', { className: 'profile-identity' }, [
        avatar(name, src, () => report?.remove()),
        el('div', { className: 'profile-identity-text' }, [
          el('h1', { id: 'profile-title', text: name, attrs: { tabindex: '-1' } }),
          // The handle is shown beside a name only (a name is not unique); alone it is already the title.
          identity
            ? el('p', { className: 'profile-handle', text: `seduhscore.com/id/${handle}` })
            : null,
        ]),
      ]),
      chips.length
        ? el('ul', { className: 'profile-labels', attrs: { role: 'list' } }, chips)
        : null,
      report,
      // SEAM C3: the "Share to story" button goes here.
    ].filter(Boolean),
  );
}

function statsRow(stats) {
  return el(
    'div',
    { className: 'profile-stats', attrs: { role: 'group', 'aria-label': 'Totals' } },
    stats.map((s) =>
      el('div', { className: 'profile-stat' }, [
        el('b', { className: 'tabular-nums', text: s.value }),
        el('span', { text: s.label }),
      ]),
    ),
  );
}

function bestCard({ entry, verified }) {
  return el(
    'div',
    {
      className: 'profile-best',
      attrs: { role: 'group', 'aria-labelledby': 'profile-best-title' },
    },
    [
      el('h2', {
        id: 'profile-best-title',
        className: 'profile-best-label',
        text: verified ? 'Best verified result' : 'Best result',
      }),
      el('p', {
        className: 'profile-best-finish',
        text: `${ordinal(entry.placing)} · ${entry.title}`,
      }),
      el('p', {
        className: 'profile-best-detail tabular-nums',
        text: [entry.detail, bestDetail(entry)].filter(Boolean).join(' · '),
      }),
      el(
        'p',
        { className: 'profile-best-source' },
        provenanceLabels(entry).map((label) =>
          el('span', { className: 'profile-provenance tag', text: label }),
        ),
      ),
    ],
  );
}

// The meta line: the kind of a non-competed entry as a small label, then the rest as text, with the team's country linked
// to its page only while the country pages are public.
function metaNodes(entry, options) {
  const rest = metaText({ ...entry, kind: 'competed' });
  const link = entry.country
    ? buildCountryChip(entry.country, { enabled: options.linkCountry })
    : null;
  const nodes = [];
  if (entry.kind !== 'competed') {
    nodes.push(el('span', { className: 'profile-entry-kind', text: KIND_LABELS[entry.kind] }));
    if (rest) nodes.push(document.createTextNode(' · '));
  }
  nodes.push(document.createTextNode(link ? rest + ' ' : rest));
  if (link) nodes.push(link);
  return nodes;
}

function entryItem(entry, options = {}) {
  const place = placeText(entry);
  return el(
    'li',
    { className: 'profile-entry' },
    [
      el('span', { className: 'profile-entry-date tabular-nums', text: dateText(entry) }),
      el(
        'div',
        { className: 'profile-entry-main' },
        [
          el('span', { className: 'profile-entry-title', text: entry.title }),
          metaText(entry)
            ? el('span', { className: 'profile-entry-meta' }, metaNodes(entry, options))
            : null,
          entry.detail
            ? el('span', { className: 'profile-entry-detail tabular-nums', text: entry.detail })
            : null,
          el(
            'span',
            { className: 'profile-provenances' },
            provenanceLabels(entry).map((label, i) =>
              el('span', {
                className: `profile-provenance tag profile-prov-${entry.provenance}${i > 0 ? ' profile-prov-membership' : ''}`,
                text: label,
              }),
            ),
          ),
        ].filter(Boolean),
      ),
      place
        ? el('span', {
            className: `profile-entry-place${entry.placing === 1 ? ' is-first' : ''}`,
            text: place,
          })
        : null,
    ].filter(Boolean),
  );
}

function yearGroup(group, open, options) {
  const n = group.entries.length;
  return el('details', { className: 'profile-year', attrs: open ? { open: '' } : {} }, [
    el('summary', { className: 'profile-year-head' }, [
      el('h3', { className: 'profile-year-label', text: group.label }),
      el('span', {
        className: 'profile-year-count',
        text: `${n} ${n === 1 ? 'entry' : 'entries'}`,
      }),
      el('span', { className: 'profile-year-cue', attrs: { 'aria-hidden': 'true' } }),
    ]),
    el(
      'ul',
      { className: 'profile-entry-list', attrs: { role: 'list' } },
      group.entries.map((entry) => entryItem(entry, options)),
    ),
  ]);
}

// The record: a summary, filter buttons (only when there is more than one kind), then the entries by year, the newest
// year open and the rest closed. Built for dozens of entries. The filter redraws the list only; the buttons stay put so
// focus does not move, and a polite status line says what is now shown.
function recordSection(entries, options) {
  const section = el(
    'section',
    { className: 'profile-body', attrs: { 'aria-labelledby': 'profile-record-title' } },
    [el('h2', { id: 'profile-record-title', className: 'profile-section-title', text: 'Record' })],
  );
  if (entries.length === 0) {
    section.append(el('p', { className: 'profile-quiet', text: 'No results on Seduh Score yet.' }));
    return section;
  }
  section.append(el('p', { className: 'profile-summary', text: summaryLine(entries) }));

  const list = el('div', { className: 'profile-record-list' });
  const status = el('p', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  let active = 'all';
  const draw = () => {
    const shown = filterEntries(entries, active);
    list.replaceChildren(
      ...groupByYear(shown).map((group, i) => yearGroup(group, i === 0, options)),
    );
    status.textContent =
      active === 'all'
        ? ''
        : `Showing ${shown.length} ${KIND_LABELS[active].toLowerCase()} ${shown.length === 1 ? 'entry' : 'entries'}.`;
  };

  const kinds = kindsPresent(entries);
  if (kinds.length > 1) {
    const buttons = [['all', 'All'], ...kinds.map((k) => [k, KIND_LABELS[k]])].map(
      ([key, label]) => {
        const button = el('button', {
          className: 'profile-filter',
          text: label,
          attrs: { type: 'button', 'aria-pressed': String(key === active) },
        });
        button.addEventListener('click', () => {
          active = key;
          for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
          draw();
        });
        return button;
      },
    );
    section.append(
      el(
        'div',
        {
          className: 'profile-filters',
          attrs: { role: 'group', 'aria-label': 'Filter the record' },
        },
        buttons,
      ),
    );
  }
  section.append(status, list);
  draw();
  return section;
}

function knockoutSection(knockout) {
  const text = knockoutText(knockout);
  if (!text) return null;
  const rows = [
    el('li', { className: 'profile-h2h-row' }, [
      el('span', { text: 'Knockout matches, all organisers' }),
      el('span', { className: 'profile-h2h-rec tabular-nums', text }),
    ]),
    ...knockout.opponents.map((o) =>
      el('li', { className: 'profile-h2h-row' }, [
        // Plain text, not a link: links into profiles are the discovery task's (SEAM C5).
        el('span', { text: `v ${o.displayName}` }),
        el('span', { className: 'profile-h2h-rec tabular-nums', text: `${o.won}–${o.lost}` }),
      ]),
    ),
  ];
  return el(
    'section',
    { className: 'profile-body', attrs: { 'aria-labelledby': 'profile-h2h-title' } },
    [
      el('h2', {
        id: 'profile-h2h-title',
        className: 'profile-section-title',
        text: 'Head to head',
      }),
      el('ul', { className: 'profile-h2h', attrs: { role: 'list' } }, rows),
    ],
  );
}

function worksWithSection(affiliations) {
  if (affiliations.length === 0) return null;
  return el(
    'section',
    { className: 'profile-body', attrs: { 'aria-labelledby': 'profile-works-title' } },
    [
      el('h2', {
        id: 'profile-works-title',
        className: 'profile-section-title',
        text: 'Works with',
      }),
      el(
        'ul',
        { className: 'profile-h2h', attrs: { role: 'list' } },
        affiliations.map((a) =>
          el(
            'li',
            { className: 'profile-h2h-row' },
            [
              el('span', { text: a.name }),
              a.role ? el('span', { className: 'profile-entry-meta', text: a.role }) : null,
            ].filter(Boolean),
          ),
        ),
      ),
    ],
  );
}

function fullPage(root, profile, options) {
  const name = profile.identity?.displayName ?? profile.handle;
  document.title = `${name} — Seduh ID — Seduh Score`;
  const stats = computeStats(profile.entries);
  const best = bestResult(profile.entries);
  pageShell(
    root,
    heroFull(profile, options),
    stats.length > 0 || best
      ? el(
          'section',
          { className: 'profile-body profile-summary-block', attrs: { 'aria-label': 'Summary' } },
          [
            stats.length > 0 ? statsRow(stats) : null,
            stats.length > 0 && hasSelfReported(profile.entries)
              ? el('p', {
                  className: 'profile-stats-note',
                  text: 'Totals include entries and team memberships the person reported themselves.',
                })
              : null,
            best ? bestCard(best) : null,
          ].filter(Boolean),
        )
      : null,
    recordSection(profile.entries, options),
    knockoutSection(profile.knockout),
    worksWithSection(profile.affiliations),
    correctionNote(profile),
  );
}

// A page with nothing to show: no name, no results, no knockout record, no affiliations.
const isAllHidden = (p) =>
  !p.identity &&
  p.entries.length === 0 &&
  knockoutText(p.knockout) === null &&
  p.affiliations.length === 0;

/**
 * Mounts the page for one handle. `handle` is lower-cased here; `client` and `fetchProfile` are for tests.
 * `linkCountry` is for tests; production leaves it to the country pages' switch.
 */
export async function mountProfilePage(
  root,
  rawHandle,
  { client, fetchProfile = fetchSeduhProfile, linkCountry, supabaseUrl } = {},
) {
  const handle = String(rawHandle ?? '').toLowerCase();
  const options = { linkCountry: linkCountry ?? undefined, supabaseUrl };
  document.title = 'Seduh ID — Seduh Score';

  async function load() {
    pageShell(
      root,
      plainHero({ title: 'Seduh ID' }),
      stateCard({ title: 'Loading…', message: 'One moment.' }),
    );
    let profile;
    try {
      profile = await raceTimeout(fetchProfile(handle, client), DEFAULT_LOAD_TIMEOUT_MS);
    } catch (err) {
      pageShell(root, plainHero({ title: 'Seduh ID' }), failureCard(err, load));
      return;
    }
    if (!profile.hasProfile) return noProfilePage(root);
    if (isAllHidden(profile)) return privatePage(root, profile);
    fullPage(root, profile, options);
  }
  await load();
}

export function mountProfileFromLocation(root, location = window.location, options = {}) {
  const handle = handleFromPath(location.pathname);
  if (!handle) {
    noProfilePage(root);
    return Promise.resolve();
  }
  return mountProfilePage(root, handle, options);
}

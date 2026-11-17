// The Seduh ID hub at /id/ (T-ID2.C5): find a claimed, public Seduh ID by name, handle or cafe, or browse by country.
// It shows only what the anonymous discovery doors return (core/seduhDiscovery.js), and the database decides who that is
// and whether discovery is open at all: while the switch is off the page says search is not open and offers nothing to
// type into. The query lives in the address (?q= and ?country=) so the landing page's box can send people here.
import { el } from '../core/dom.js';
import { countryName } from '../core/country.js';
import { raceTimeout, DEFAULT_LOAD_TIMEOUT_MS } from '../core/timeout.js';
import {
  SEARCH_MAX,
  SEARCH_MIN,
  cleanQuery,
  fetchDiscoveryCountries,
  profilePath,
  searchSeduhIds,
} from '../core/seduhDiscovery.js';
import { photoSrc } from '../core/seduhProfile.js';
import { avatar, pageShell, plainHero, stateCard } from './profileScreen.js';

const TITLE_ID = 'hub-title';
const TITLE = 'Find a competitor';
const INTRO =
  'Search Seduh IDs by name, handle or café, or browse by country. Only people who have claimed their Seduh ID and chosen to show it appear here.';

/** Pure. The words under the search box. */
export function statusText({ tooShort = false, country, count, more }) {
  const where = country ? ` in ${countryName(country) ?? country}` : '';
  if (tooShort) return `Type at least ${SEARCH_MIN} letters to search.`;
  if (count === 0)
    return `No one found${where}. People who keep their Seduh ID private do not appear in search.`;
  const people = count === 1 ? '1 person' : `${count} people`;
  return more
    ? `Showing the first ${people}${where}. Narrow your search to see others.`
    : `${people} found${where}.`;
}

function personRow(person, supabaseUrl) {
  const src = photoSrc(person.photoUrl, supabaseUrl);
  const where = person.countryCode ? (countryName(person.countryCode) ?? person.countryCode) : null;
  return el('li', {}, [
    el('a', { className: 'hub-person panel', attrs: { href: profilePath(person.handle) } }, [
      avatar(person.name, src),
      el('span', { className: 'hub-person-text' }, [
        el('span', { className: 'hub-person-name', text: person.name }),
        el('span', {
          className: 'hub-person-meta',
          text: where ? `${person.handle} · ${where}` : person.handle,
        }),
      ]),
    ]),
  ]);
}

/**
 * Mounts the hub. `search`, `loadCountries`, `location` and `supabaseUrl` are for tests; production leaves them alone.
 */
export async function mountHub(
  root,
  {
    search = searchSeduhIds,
    loadCountries = fetchDiscoveryCountries,
    client,
    location = window.location,
    supabaseUrl = import.meta.env?.VITE_SUPABASE_URL,
  } = {},
) {
  document.title = 'Find a competitor — Seduh ID';
  const params = new URLSearchParams(location.search);
  const startQuery = (params.get('q') ?? '').slice(0, SEARCH_MAX);
  const startCountry = /^[A-Za-z]{2}$/.test(params.get('country') ?? '')
    ? params.get('country').toUpperCase()
    : null;

  pageShell(
    root,
    plainHero({ title: TITLE, intro: INTRO, titleId: TITLE_ID }),
    stateCard({ title: 'Loading…', message: 'One moment.' }),
  );

  let countries;
  try {
    countries = await raceTimeout(loadCountries(client), DEFAULT_LOAD_TIMEOUT_MS);
  } catch (err) {
    const retry = el('button', {
      className: 'action action-primary',
      text: 'Try again',
      attrs: { type: 'button' },
    });
    retry.addEventListener('click', () =>
      mountHub(root, { search, loadCountries, client, location, supabaseUrl }).then(() =>
        document.getElementById(TITLE_ID)?.focus(),
      ),
    );
    pageShell(
      root,
      plainHero({ title: TITLE, titleId: TITLE_ID }),
      stateCard({
        title: 'Could not load this page',
        message: err?.timedOut
          ? 'This is taking longer than expected. Check your connection and try again.'
          : 'Something went wrong. Please try again.',
        role: 'alert',
        actions: [retry],
      }),
    );
    return;
  }

  // Switch off. (An open hub with no one listed is not closed: it still has a search box.)
  if (!countries.open) {
    pageShell(
      root,
      plainHero({ title: TITLE, titleId: TITLE_ID }),
      stateCard({
        title: 'Seduh ID search is not open yet',
        message:
          'You can still open a Seduh ID page from a link or QR code the person shares with you.',
        actions: [
          el('a', {
            className: 'action action-outline',
            text: 'Back to Seduh Score',
            attrs: { href: '/' },
          }),
        ],
      }),
    );
    return;
  }

  let activeCountry = startCountry;
  let seq = 0;

  const input = el('input', {
    className: 'hub-input',
    attrs: {
      id: 'hub-q',
      name: 'q',
      type: 'search',
      maxlength: String(SEARCH_MAX),
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
    },
  });
  input.value = startQuery;
  const status = el('p', {
    className: 'hub-note',
    attrs: { role: 'status', 'aria-live': 'polite', id: 'hub-note' },
  });
  const list = el('ul', { className: 'hub-results', attrs: { 'aria-labelledby': 'hub-note' } });
  const chips = el('ul', { className: 'hub-countries' });

  function drawChips() {
    chips.replaceChildren(
      ...countries.countries.map((c) => {
        const btn = el('button', {
          className: `hub-country tag${c.code === activeCountry ? ' tag-solid' : ''}`,
          text: `${countryName(c.code) ?? c.code} (${c.people})`,
          attrs: {
            type: 'button',
            'aria-pressed': String(c.code === activeCountry),
            'data-country': c.code,
          },
        });
        btn.addEventListener('click', () => {
          activeCountry = activeCountry === c.code ? null : c.code;
          drawChips();
          run();
        });
        return el('li', {}, [btn]);
      }),
    );
  }

  function syncUrl(q) {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (activeCountry) next.set('country', activeCountry);
    const qs = next.toString();
    try {
      window.history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
    } catch {
      /* the address is a convenience only */
    }
  }

  async function run() {
    // Every run supersedes any earlier one in flight, including runs that end below without asking.
    const mine = ++seq;
    const raw = input.value.trim();
    const q = cleanQuery(raw);
    syncUrl(raw);
    if (raw && !q) {
      list.replaceChildren();
      status.textContent =
        raw.length < SEARCH_MIN
          ? statusText({ tooShort: true })
          : `Search for ${SEARCH_MAX} characters or fewer.`;
      return;
    }
    if (!q && !activeCountry) {
      list.replaceChildren();
      status.textContent = '';
      return;
    }
    status.textContent = 'Searching…';
    let answer;
    try {
      answer = await raceTimeout(
        search({ query: q, country: activeCountry }, client),
        DEFAULT_LOAD_TIMEOUT_MS,
      );
    } catch {
      if (mine !== seq) return;
      list.replaceChildren();
      status.textContent = 'Search did not work just now. Check your connection and try again.';
      return;
    }
    if (mine !== seq) return;
    if (!answer.open) {
      list.replaceChildren();
      status.textContent = 'Seduh ID search is not open.';
      return;
    }
    list.replaceChildren(...answer.results.map((p) => personRow(p, supabaseUrl)));
    status.textContent = statusText({
      country: activeCountry,
      count: answer.results.length,
      more: answer.more,
    });
  }

  const form = el(
    'form',
    {
      className: 'hub-form',
      attrs: { role: 'search', 'aria-label': 'Find a competitor', novalidate: '' },
    },
    [
      el('label', {
        className: 'hub-label',
        attrs: { for: 'hub-q' },
        text: 'Name, handle or café',
      }),
      el('div', { className: 'hub-form-row' }, [
        input,
        el('button', {
          className: 'action action-primary',
          text: 'Search',
          attrs: { type: 'submit' },
        }),
      ]),
    ],
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run();
  });

  pageShell(
    root,
    plainHero({ title: TITLE, intro: INTRO, titleId: TITLE_ID }),
    el(
      'section',
      { className: 'profile-body hub-body' },
      [
        form,
        countries.countries.length
          ? el('div', { className: 'hub-browse' }, [
              el('h2', { className: 'profile-section-title', text: 'Browse by country' }),
              chips,
            ])
          : null,
        status,
        list,
      ].filter(Boolean),
    ),
  );
  drawChips();
  if (startQuery || startCountry) await run();
}

// Behind the Seduh reader. bts/index.html is complete static HTML: every chapter of every cycle, stacked. This
// turns it into a reader so the page stops growing with each release: the cycle rail becomes tabs, one chapter
// shows at a time, picked from a chapter list or older/newer buttons, and search plus topic filters reach every
// entry. Each chapter's id is its link (#ms-kiarong-btc). No framework and no data: everything is read from the
// markup, so a new chapter is a new <section class="bts-chapter"> and nothing here changes.

export const TOPICS = [
  'Formats',
  'In the room',
  'Trust & security',
  'Platform',
  'Public & community',
  'Groundwork',
];

// Shipped text longer than this folds to four lines behind a toggle.
const FOLD_AT = 320;

// Old links that moved when a chapter was split (the Gadong-to-Kiarong move, 2026-11-09).
const ALIASES = { 'ms-gadong-throwdown': 'ms-kiarong-throwdown' };

function make(doc, tag, props = {}, children = []) {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

export function enhanceBts(root, win = root.ownerDocument.defaultView) {
  const doc = root.ownerDocument;
  const reader = root.querySelector('[data-bts-reader]');
  const pane = root.querySelector('[data-bts-pane]');
  if (!reader || !pane) return null;

  const chapters = [...pane.querySelectorAll('.bts-chapter')];
  if (chapters.length === 0) return null;
  const groups = [...pane.querySelectorAll('.bts-cycle-group')];
  const cycleOf = (chapter) => chapter.closest('.bts-cycle-group').dataset.cycle;
  const titleOf = (chapter) => chapter.querySelector('.bts-chapter-title').textContent.trim();
  const dateOf = (chapter) => {
    const spans = chapter.querySelectorAll('.bts-chapter-meta span');
    return (spans[1] && spans[1].textContent) || '';
  };
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const newest = chapters[0];
  const reduceMotion = () =>
    Boolean(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const state = { chapter: newest.id, q: '', tag: null, live: false };
  const filtering = () => Boolean(state.q || state.tag || state.live);

  root.classList.add('bts-js');
  // Listeners on the page root and the window go through one signal, so destroy() can remove them (tests mount the
  // reader many times on the same body).
  const listening = new AbortController();
  const { signal } = listening;

  // ---- folding the long Shipped text ----
  let folds = 0;
  for (const entry of pane.querySelectorAll('.bts-entry')) {
    const tags = entry.querySelector('.bts-tags');
    const foot = make(doc, 'div', { className: 'bts-entry-foot' });
    tags.replaceWith(foot);
    foot.append(tags);
    const text = entry.querySelector('.bts-ship-v');
    if (text.textContent.length > FOLD_AT) {
      text.classList.add('is-folded');
      folds += 1;
      text.id = text.id || `bts-ship-${folds}`;
      const toggle = make(doc, 'button', {
        type: 'button',
        className: 'bts-text-btn',
        'aria-expanded': 'false',
        'aria-controls': text.id,
        text: 'Read the whole receipt',
      });
      toggle.addEventListener('click', () => {
        const open = text.classList.toggle('is-folded') === false;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Fold it back' : 'Read the whole receipt';
      });
      foot.append(toggle);
    }
  }

  // ---- the rail picks a cycle (plain links marked aria-current, not an ARIA tab set: no arrow keys needed) ----
  const cycleLinks = [...root.querySelectorAll('a.bts-cycle[data-cycle]')];
  const rail = root.querySelector('.bts-rail');
  for (const link of cycleLinks) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const first = chapters.find((c) => cycleOf(c) === link.dataset.cycle);
      if (first) go(first.id, false);
    });
  }

  // ---- tools: search, topics, live now ----
  const search = make(doc, 'input', {
    id: 'bts-search',
    type: 'search',
    placeholder: 'Search the build log',
    autocomplete: 'off',
    'aria-label': 'Search the build log',
  });
  const chips = make(doc, 'div', {
    className: 'bts-chips',
    role: 'group',
    'aria-label': 'Filter by topic',
  });
  const chip = (label, data) =>
    make(doc, 'button', {
      type: 'button',
      className: 'tag bts-chip',
      'aria-pressed': 'false',
      ...data,
      text: label,
    });
  const liveChip = chip('Live now', { 'data-live': '' });
  chips.append(liveChip, ...TOPICS.map((t) => chip(t, { 'data-topic': t })));
  const tools = make(doc, 'div', { className: 'bts-tools' }, [
    make(doc, 'label', { className: 'bts-search', for: 'bts-search' }, [search]),
    chips,
  ]);
  reader.before(tools);

  search.addEventListener('input', () => {
    state.q = search.value.trim().toLowerCase();
    render();
  });
  chips.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-live')) state.live = !state.live;
    else state.tag = state.tag === button.dataset.topic ? null : button.dataset.topic;
    render();
  });

  // ---- chapter list ----
  const tocLabel = make(doc, 'p', { className: 'bts-toc-label', id: 'bts-toc-label' });
  const tocList = make(doc, 'ul', {
    className: 'bts-toc-list',
    'aria-labelledby': 'bts-toc-label',
  });
  const toc = make(doc, 'nav', { className: 'bts-toc', 'aria-label': 'Chapters' }, [
    tocLabel,
    tocList,
  ]);
  reader.prepend(toc);

  // ---- status line (filter mode) and pager ----
  const result = make(doc, 'div', { className: 'bts-result', role: 'status' });
  const empty = make(doc, 'div', { className: 'empty', hidden: '', 'data-kind': 'no-results' }, [
    make(doc, 'p', { className: 'empty-title', text: 'Nothing matches.' }),
    make(doc, 'p', {
      className: 'empty-text',
      text: "Either the search is too picky, or it hasn't been built yet.",
    }),
  ]);
  const pager = make(doc, 'div', { className: 'bts-pager' });
  pane.prepend(result);
  pane.append(empty, pager);

  function matches(entry, chapter) {
    if (state.live && !entry.hasAttribute('data-live')) return false;
    if (state.tag && !(entry.dataset.tags || '').split('|').includes(state.tag)) return false;
    if (state.q) {
      const hay = `${entry.textContent} ${titleOf(chapter)}`.toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function render() {
    const current = byId.get(state.chapter);
    const cycle = cycleOf(current);

    for (const link of cycleLinks) {
      if (!filtering() && link.dataset.cycle === cycle) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    const selected = cycleLinks.find((l) => l.hasAttribute('aria-current'));
    if (selected && rail && rail.scrollWidth > rail.clientWidth) {
      const r = rail.getBoundingClientRect();
      const b = selected.getBoundingClientRect();
      if (b.left < r.left || b.right > r.right) rail.scrollLeft += b.left - r.left - 8;
    }

    for (const button of chips.querySelectorAll('button')) {
      const on = button.hasAttribute('data-live') ? state.live : state.tag === button.dataset.topic;
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('tag-solid', on);
    }

    // Chapter list: the selected cycle's chapters.
    const place = cycleLinks.find((l) => l.dataset.cycle === cycle);
    tocLabel.textContent = `${place ? place.querySelector('.bts-cycle-place').textContent : ''} chapters`;
    // The chapter being read carries a mark before its title (not colour alone); aria-current already says so to a
    // screen reader, so the mark itself is hidden from it.
    const chTitle = (c) => {
      const title = make(doc, 'span', { className: 'bts-ch-title' });
      if (!filtering() && c.id === state.chapter) {
        title.append(make(doc, 'span', { 'aria-hidden': 'true', text: '▸ ' }));
      }
      title.append(titleOf(c));
      return title;
    };
    tocList.replaceChildren(
      ...chapters
        .filter((c) => cycleOf(c) === cycle)
        .map((c) => {
          const meta = make(doc, 'span', { className: 'bts-ch-meta' });
          if (c === newest)
            meta.append(make(doc, 'span', { className: 'bts-ch-new', text: 'Latest' }));
          meta.append(
            make(doc, 'span', { text: dateOf(c) }),
            make(doc, 'span', {
              text: `${c.querySelectorAll('.bts-entry').length} entries`,
            }),
          );
          const button = make(
            doc,
            'button',
            {
              type: 'button',
              className: 'bts-ch',
              'data-chapter': c.id,
              'aria-current': String(!filtering() && c.id === state.chapter),
            },
            [meta, chTitle(c)],
          );
          button.addEventListener('click', () => go(c.id, false, 'toc'));
          return make(doc, 'li', {}, [button]);
        }),
    );

    if (filtering()) {
      let hits = 0;
      let inChapters = 0;
      for (const group of groups) group.hidden = false;
      for (const c of chapters) {
        let any = false;
        for (const entry of c.querySelectorAll('.bts-entry')) {
          const ok = matches(entry, c);
          entry.hidden = !ok;
          if (ok) {
            hits += 1;
            any = true;
            const text = entry.querySelector('.bts-ship-v.is-folded');
            if (text && state.q && text.textContent.toLowerCase().includes(state.q)) {
              entry.querySelector('.bts-text-btn').click();
            }
          }
        }
        c.hidden = !any;
        if (any) inChapters += 1;
      }
      for (const group of groups) {
        group.hidden = !group.querySelector('.bts-chapter:not([hidden])');
        group.querySelector('.bts-cycle-intro').hidden = true;
      }
      const label = [
        state.q ? `“${search.value.trim()}”` : '',
        state.tag || '',
        state.live ? 'Live now' : '',
      ]
        .filter(Boolean)
        .join(' + ');
      const clear = make(doc, 'button', {
        type: 'button',
        className: 'bts-text-btn',
        text: 'Clear and go back to the chapters',
      });
      clear.addEventListener('click', (event) => {
        search.value = '';
        // Back to search only from the keyboard (detail 0); a tap must not raise the on-screen keyboard.
        go(state.chapter, false, event.detail === 0 ? 'search' : undefined);
      });
      result.replaceChildren(
        make(doc, 'span', {
          text: `${hits} ${hits === 1 ? 'entry' : 'entries'} across ${inChapters} ${
            inChapters === 1 ? 'chapter' : 'chapters'
          } · ${label}`,
        }),
        clear,
      );
      empty.hidden = hits > 0;
      pager.hidden = true;
      return;
    }

    // One chapter. The status region stays in the tree (empty), so its next text is announced.
    result.replaceChildren();
    empty.hidden = true;
    for (const group of groups) {
      group.hidden = group.dataset.cycle !== cycle;
      group.querySelector('.bts-cycle-intro').hidden = false;
    }
    for (const c of chapters) {
      c.hidden = c.id !== state.chapter;
      for (const entry of c.querySelectorAll('.bts-entry')) entry.hidden = false;
    }

    const index = chapters.indexOf(current);
    const newer = chapters[index - 1];
    const older = chapters[index + 1];
    const pg = (target, label, className) => {
      const button = make(
        doc,
        'button',
        { type: 'button', className: `bts-pg panel ${className}` },
        [make(doc, 'small', { text: label }), make(doc, 'span', { text: titleOf(target) })],
      );
      button.addEventListener('click', () => go(target.id, true, 'heading'));
      return button;
    };
    pager.replaceChildren(
      ...(newer ? [pg(newer, '← Newer', 'is-newer')] : []),
      ...(older ? [pg(older, 'Older →', 'is-older')] : []),
    );
    pager.hidden = false;
  }

  // render() rebuilds the chapter list and the pager, so the control that was pressed is gone afterwards. `focus`
  // says where keyboard focus lands instead: the same chapter in the list, the new chapter's heading, or search.
  function go(id, scroll, focus) {
    const target = byId.get(ALIASES[id] || id);
    if (!target) return;
    state.chapter = target.id;
    state.q = '';
    state.tag = null;
    state.live = false;
    search.value = '';
    render();
    if (win && win.location && win.location.hash !== `#${target.id}`) {
      try {
        win.history.replaceState(null, '', `#${target.id}`);
      } catch {
        // A sandboxed frame can refuse; the page still works without the address changing.
      }
    }
    const build = root.querySelector('#bts-build') || reader;
    if (scroll && typeof build.scrollIntoView === 'function') {
      build.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    if (focus === 'toc') {
      const again = tocList.querySelector(`[data-chapter="${target.id}"]`);
      if (again) again.focus({ preventScroll: true });
    } else if (focus === 'heading') {
      const heading = target.querySelector('.bts-chapter-title');
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: Boolean(scroll) });
    } else if (focus === 'search') {
      search.focus({ preventScroll: true });
    }
  }

  // In-page links to a chapter (the live-run card, the scoreboard) open it in the reader.
  root.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || link.classList.contains('bts-cycle')) return;
      const id = link.getAttribute('href').slice(1);
      if (!byId.has(ALIASES[id] || id)) return;
      event.preventDefault();
      go(id, true, 'heading');
    },
    { signal },
  );

  const fromHash = () => {
    const id = win && win.location ? win.location.hash.slice(1) : '';
    if (byId.has(ALIASES[id] || id)) go(id, false);
    else render();
  };
  if (win) win.addEventListener('hashchange', fromHash, { signal });
  fromHash();

  return { go, state, render, destroy: () => listening.abort() };
}

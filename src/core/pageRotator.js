// Paging for a surface nobody can scroll (a venue projector): split a long list into fixed pages, and rotate
// through them on a timer. Format-agnostic — it knows lists and time, not what the list is — so any
// format's projector (or a sponsor loop) can use it unedited.
//
// Why pages and not a scrolling or shrunk table: a continuously moving table can't be read, and scaling a
// long table to fit shrinks the type below what the back of the room can read. A short page held long enough
// to find your name in is the standard answer.

// Splits `items` into pages of at most `pageSize`. `groupOf(item)` (optional) names the group an item belongs
// to (e.g. its tied position); consecutive items of one group are not split across a page boundary when the
// whole group fits on one page — the group moves to the next page instead, leaving the earlier page a row or
// two short. A group longer than a page is split anyway (nothing else is possible), and is not moved: moving
// it would only leave the earlier page short for no benefit.
export function paginate(items, pageSize, { groupOf } = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new TypeError('paginate: pageSize must be a positive whole number');
  }
  const pages = [];
  let start = 0;
  while (start < items.length) {
    let end = Math.min(start + pageSize, items.length);
    if (groupOf && end < items.length && groupOf(items[end - 1]) === groupOf(items[end])) {
      const group = groupOf(items[end - 1]);
      let groupStart = end - 1;
      while (groupStart > start && groupOf(items[groupStart - 1]) === group) groupStart -= 1;
      let groupEnd = end;
      while (groupEnd < items.length && groupOf(items[groupEnd]) === group) groupEnd += 1;
      // Only when the group starts mid-page AND fits on a page of its own.
      if (groupStart > start && groupEnd - groupStart <= pageSize) end = groupStart;
    }
    pages.push(items.slice(start, end));
    start = end;
  }
  return pages;
}

// Where page `index` sits in the whole list, for a "9 to 16 of 17" label: 1-based first and last item and the
// total, from the pages `paginate` returned.
export function pageRange(pages, index) {
  const before = pages.slice(0, index).reduce((sum, page) => sum + page.length, 0);
  return {
    first: before + 1,
    last: before + pages[index].length,
    total: pages.reduce((sum, page) => sum + page.length, 0),
  };
}

// Rotates through `pageCount` pages: shows page 0 at once, then each next page after `dwellMs`, wrapping
// round, until stopped. `onPage(index, { dwellMs, startedAt })` is called for every page shown, so a caller
// can paint it and start a progress ring for the time it will be held. One page (or none) never rotates and
// never sets a timer. Timers are injectable so it can be driven without waiting.
export function createPageRotator({
  pageCount,
  dwellMs,
  onPage,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let index = 0;
  let timer = null;
  let running = false;

  function show() {
    onPage(index, { dwellMs, startedAt: now() });
    if (pageCount > 1 && running) {
      timer = setTimer(() => {
        index = (index + 1) % pageCount;
        show();
      }, dwellMs);
    }
  }

  return {
    start() {
      if (running || pageCount < 1) return;
      running = true;
      index = 0;
      show();
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    index: () => index,
  };
}

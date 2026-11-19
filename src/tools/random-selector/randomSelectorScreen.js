import { el, svgEl, withFocusPreservation } from '../../core/dom.js';
import { buildTablist } from '../../core/tablist.js';
import { buildCommunityToolChrome } from '../../community/toolChrome.js';
import { copyText } from '../../core/clipboard.js';
import { downloadCsv } from '../../core/export.js';
import {
  decodeShare,
  DEMO_ENTRIES,
  browserStorage,
  DEFAULT_BOARD_TITLE,
  DRAW_PRESETS,
  encodeShare,
  entriesFromCsv,
  checkEntries,
  describeEntryProblems,
  entriesToCsv,
  formatEntries,
  insertDraftLine,
  loadSaved,
  MAX_ENTRIES,
  parseEntries,
  PETROL_ACCENT_HEX,
  removeDraftLine,
  replaceDraftLine,
  readableOn,
  saveCurrent,
  validDrawPreset,
  validAccentColor,
  validBoardTitle,
  validSoundLevel,
  weightedIndex,
} from './randomSelector.js';

// A CSV bigger than this is refused before it is read: reading a huge file would freeze the page.
const MAX_IMPORT_BYTES = 1_000_000;
const CELLS_PER_ROW = 14;
const ROWS = 4;
const ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function button(text, className, onClick, attrs = {}) {
  const node = el('button', { className, text, attrs: { type: 'button', ...attrs } });
  node.addEventListener('click', onClick);
  return node;
}

// Lay a name out on the board: one character per flap by code point (an emoji is one flap, not a
// split surrogate), words kept whole on a row where they fit, and an ellipsis in the last flap when
// the name is still too long. Each row is centred across the board, and the block of rows is centred
// down it (one line sits on a middle row). The result panel below always shows the full name.
export function boardCells(value) {
  const rows = [];
  let row = '';
  const push = () => {
    rows.push(row);
    row = '';
  };
  for (const word of String(value).toUpperCase().split(/\s+/).filter(Boolean)) {
    const characters = Array.from(word);
    if (row && Array.from(row).length + 1 + characters.length <= CELLS_PER_ROW) {
      row += ` ${word}`;
      continue;
    }
    if (row) push();
    for (let start = 0; start < characters.length; start += CELLS_PER_ROW) {
      row = characters.slice(start, start + CELLS_PER_ROW).join('');
      if (start + CELLS_PER_ROW < characters.length) push();
    }
  }
  if (row) push();
  const shown = rows.slice(0, ROWS);
  const top = Math.floor((ROWS - shown.length) / 2);
  const cells = Array.from({ length: ROWS }, (_, index) => {
    const characters = Array.from(shown[index - top] ?? '');
    const pad = Math.floor((CELLS_PER_ROW - characters.length) / 2);
    return Array.from(
      { length: CELLS_PER_ROW },
      (_cell, column) => characters[column - pad] ?? ' ',
    );
  });
  if (rows.length > ROWS) cells[ROWS - 1][CELLS_PER_ROW - 1] = '…';
  return cells.flat();
}

// The board is a picture of the result: its name comes from the draw state, never from the
// characters flickering across the flaps, which would read out as 56 single letters.
function splitFlapBoard(value, label) {
  const cells = boardCells(value);
  return el(
    'div',
    { className: 'selector-board', attrs: { role: 'img', 'aria-label': label } },
    Array.from({ length: ROWS }, (_, rowIndex) =>
      el(
        'div',
        { className: 'selector-flap-row' },
        cells.slice(rowIndex * CELLS_PER_ROW, (rowIndex + 1) * CELLS_PER_ROW).map((character) =>
          el('span', {
            className: 'selector-flap',
            text: character,
          }),
        ),
      ),
    ),
  );
}

function randomCharacter() {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
}

function createTicker() {
  let context = null;
  let sampleAvailable = typeof Audio === 'function';
  let lastSampleAt = 0;
  const sample = sampleAvailable ? new Audio('/sounds/split-flap-click.mp3') : null;
  if (sample) sample.preload = 'auto';

  function ensure() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  function syntheticTick(volume) {
    try {
      playSyntheticTick(volume);
    } catch {
      // No usable audio at all: the board is still a complete signal on its own.
    }
  }

  function playSyntheticTick(volume) {
    const audio = ensure();
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = 105 + Math.random() * 45;
    gain.gain.setValueAtTime(0.018 * volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.045);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.05);
  }

  // play() returns a promise in browsers, nothing in some environments, and can throw: every path
  // here goes through one promise so none of them can leave the draw half-finished.
  function playSample() {
    try {
      return Promise.resolve(sample.play());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  let unlocked = false;

  // Sound is a courtesy on top of the board, never something a draw depends on: nothing below may
  // throw out of unlock() or tick(), or a draw would stop before it shows its result.
  return {
    unlock() {
      try {
        ensure();
        // Once per page: the unlock play/pause must not run again over a live tick.
        if (!sample || unlocked) return;
        unlocked = true;
        sample.muted = true;
        playSample()
          .then(() => {
            sample.pause();
            sample.currentTime = 0;
            sample.muted = false;
          })
          .catch(() => {
            sample.muted = false;
            sampleAvailable = false;
          });
      } catch {
        sampleAvailable = false;
      }
    },
    tick(volume) {
      try {
        const now = performance.now();
        if (sampleAvailable && sample && now - lastSampleAt >= 105) {
          lastSampleAt = now;
          sample.volume = Math.min(1, volume * 1.5);
          sample.currentTime = 0;
          playSample().catch((error) => {
            // AbortError only means a newer play() or pause() pre-empted this one: not a failure.
            if (error?.name === 'AbortError') return;
            sampleAvailable = false;
            syntheticTick(volume);
          });
          return;
        }
        if (!sampleAvailable) syntheticTick(volume);
      } catch {
        sampleAvailable = false;
      }
    },
  };
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function mountRandomSelector(root, { storage = browserStorage() } = {}) {
  const sharedParam = new URLSearchParams(window.location.search).get('draw');
  const shared = decodeShare(sharedParam);
  // Saved settings (sound on or off) still apply to a shared list; only its entries and history don't.
  const saved = loadSaved(storage);
  const initialDraft = shared?.draft ?? saved?.draft ?? DEMO_ENTRIES.join('\n');
  const state = {
    draft: initialDraft,
    entries: parseEntries(initialDraft),
    removeAfterDraw: shared?.removeAfterDraw ?? saved?.removeAfterDraw ?? false,
    history: shared ? [] : (saved?.history ?? []),
    drawPreset: shared?.drawPreset ?? saved?.drawPreset ?? 'standard',
    soundLevel: shared?.soundLevel ?? saved?.soundLevel ?? 0.6,
    boardTitle: shared?.boardTitle ?? saved?.boardTitle ?? DEFAULT_BOARD_TITLE,
    // null is a real answer here ("no custom accent"), so it is not chained with ??.
    accentColor: shared ? shared.accentColor : (saved?.accentColor ?? null),
    winner: 'READY',
    drawn: null,
    spinning: false,
    soundOn: saved?.soundOn ?? true,
    reveal: null,
    note: shared
      ? 'Shared draw loaded. It replaces your own saved list as soon as you edit or draw.'
      : sharedParam
        ? 'That share link could not be read, so your own list was loaded instead.'
        : '',
    presenting: false,
    undo: null,
    // Which side tab is showing, and which of its three sections are open (neither is saved).
    tab: 'entries',
    open: { weights: false, draw: false, look: false },
  };
  const chrome = buildCommunityToolChrome({
    toolId: 'random-selector',
    toolName: 'Random Selector',
    edition: 'Split-flap edition',
  });
  const ticker = createTicker();
  let tickHandle = null;
  let finishHandle = null;

  // render() tears the whole screen down, so anything a screen reader must hear lives outside
  // that subtree: a live region created inside it is replaced before it can be announced.
  const live = el('div', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  const host = el('div', { className: 'rs-host' });
  // One wrapper holds the chrome, the tool and the live region: Present mode and Fullscreen act on it.
  const page = el('div', { className: 'rs-page' });
  let announcements = 0;

  // The entry list is one long-lived node, moved into each fresh tree, so its caret, scroll
  // position and value survive the re-render that every keystroke triggers.
  const entriesField = el('textarea', {
    className: 'rs-textarea',
    attrs: {
      id: 'rs-entries',
      rows: '10',
      spellcheck: 'false',
      'data-focus-key': 'entries',
      'aria-describedby': 'rs-entries-hint rs-entries-warning',
    },
  });
  entriesField.addEventListener('input', () => onEntriesInput());

  // Fields that commit on blur (weights, title, colour) or fire continuously (volume) must not
  // trigger a rebuild: it would replace the very control being used, so a Tab lands on <body>, a
  // slider drag is dropped and the click that caused the blur is swallowed. They update in place.
  const ui = {
    app: null,
    titleCell: null,
    percentCells: [],
    totalCell: null,
    colourCode: null,
    flaps: [],
    drawButton: null,
    countTab: null,
    historyTab: null,
    summaries: {},
    weightsList: null,
    colourInput: null,
    accentReset: null,
    oddsFills: [],
    warning: null,
    undoButton: null,
  };
  let lastWarning = '';
  let weightNote = '';

  function totalWeight() {
    return state.entries.reduce((sum, entry) => sum + entry.weight, 0);
  }

  const oddsText = (entry, total) => `${((entry.weight / total) * 100).toFixed(1)}%`;

  function refreshWeightReadouts() {
    const total = totalWeight();
    state.entries.forEach((entry, index) => {
      const cell = ui.percentCells[index];
      if (cell) cell.textContent = oddsText(entry, total);
      const fill = ui.oddsFills[index];
      if (fill) fill.style.width = `${(entry.weight / total) * 100}%`;
    });
    if (ui.totalCell) ui.totalCell.textContent = `Total weight ${total}`;
    if (entriesField.value !== state.draft) entriesField.value = state.draft;
    showEntryProblems();
    refreshSummaries();
  }

  // The one line each closed section shows, so a closed section still says what is set in it.
  function summaryOf(key) {
    if (key === 'weights') {
      const count = state.entries.length;
      if (!count) return 'No names yet';
      const names = `${count} ${count === 1 ? 'name' : 'names'}`;
      const equal = state.entries.every((entry) => entry.weight === state.entries[0].weight);
      return equal ? `${names}, all ${(100 / count).toFixed(1)}%` : `${names}, weighted odds`;
    }
    if (key === 'draw') {
      const preset = DRAW_PRESETS[state.drawPreset];
      const sound = state.soundOn ? `sound ${Math.round(state.soundLevel * 100)}%` : 'sound off';
      return `${preset.label} speed (${preset.duration / 1000} s) · ${sound}`;
    }
    return `Title “${state.boardTitle}” · ${state.accentColor ? state.accentColor.toUpperCase() : 'Petrol colour'}`;
  }

  function refreshSummaries() {
    for (const key of Object.keys(ui.summaries)) {
      if (ui.summaries[key]) ui.summaries[key].textContent = summaryOf(key);
    }
  }

  // One row per entry: the name, a weight box with room around it, and the entry's share of the
  // draw as a bar and a percentage. The column heads are the first row of the same scrolling list
  // (sticky), so they stay aligned with the columns whether or not a scrollbar is showing.
  function fillWeightRows(container) {
    ui.percentCells = [];
    ui.oddsFills = [];
    const total = totalWeight();
    const rows = state.entries.map((entry, index) => {
      const field = el('input', {
        className: 'rs-weight-input',
        attrs: {
          type: 'number',
          inputmode: 'numeric',
          min: '1',
          max: '1000',
          step: '1',
          value: String(entry.weight),
          'aria-label': `Weight for ${entry.name}`,
          'data-focus-key': `weight-${index}`,
          ...(state.spinning ? { disabled: '' } : {}),
        },
      });
      field.addEventListener('change', () => {
        if (state.spinning) return;
        const typed = field.value.trim();
        const next = Number(typed);
        const valid = typed !== '' && Number.isFinite(next) && next >= 1;
        const before = entry.weight;
        if (valid) entry.weight = Math.min(1000, Math.round(next));
        field.value = String(entry.weight);
        // A weight that is not used as typed is said out loud, never changed quietly.
        weightNote = !valid
          ? `Weight for ${entry.name} must be 1 to 1000, so it stays ${before}.`
          : entry.weight !== next
            ? `Weight for ${entry.name} is ${entry.weight}: weights run from 1 to 1000.`
            : '';
        if (weightNote) speak(weightNote);
        // Only this entry's line changes: rewriting the whole list from the parsed entries would
        // drop blank lines and any entries past the limit.
        state.draft = replaceDraftLine(state.draft, index, entry);
        dropUndo();
        persist();
        refreshWeightReadouts();
      });
      const percent = el('span', {
        className: 'rs-odds-value',
        text: oddsText(entry, total),
      });
      const fill = el('span', { className: 'rs-odds-fill' });
      fill.style.width = `${(entry.weight / total) * 100}%`;
      ui.percentCells[index] = percent;
      ui.oddsFills[index] = fill;
      return el('div', { className: 'rs-weight-row' }, [
        el('span', { className: 'rs-weight-name', text: entry.name }),
        field,
        el('div', { className: 'rs-odds' }, [
          el('span', { className: 'sr-only', text: `Odds for ${entry.name}: ` }),
          el('span', { className: 'rs-odds-bar', attrs: { 'aria-hidden': 'true' } }, [fill]),
          percent,
        ]),
      ]);
    });
    const head = el('div', { className: 'rs-weights-head', attrs: { 'aria-hidden': 'true' } }, [
      el('span', { text: 'ENTRY' }),
      el('span', { text: 'WEIGHT' }),
      el('span', { text: 'ODDS' }),
    ]);
    container.replaceChildren(...(rows.length ? [head, ...rows] : []));
  }

  // Typing in the entry list must not rebuild the screen: that moves the textarea, which ends an
  // IME or predictive-keyboard composition and bounces a phone's soft keyboard on every key. Only
  // what depends on the list is refreshed here, in place.
  function onEntriesInput() {
    if (state.spinning) return;
    dropUndo();
    weightNote = '';
    state.draft = entriesField.value;
    state.entries = parseEntries(state.draft);
    state.reveal = null;
    persist();
    const count = state.entries.length;
    if (ui.countTab) ui.countTab.textContent = String(count);
    if (ui.drawButton) {
      if (count) ui.drawButton.removeAttribute('aria-disabled');
      else ui.drawButton.setAttribute('aria-disabled', 'true');
    }
    ui.app?.querySelector('.rs-reveal')?.remove();
    if (ui.weightsList) fillWeightRows(ui.weightsList);
    refreshWeightReadouts(); // also refreshes the warning line
  }

  // While drawing, one COLUMN of flaps turns over per tick, sweeping across the board, instead of
  // the whole board changing at once. No flap changes more than about once a second, so the board
  // stays far below the three-flashes-a-second limit (WCAG 2.3.1) at every preset, in Present mode
  // too. The flaps are updated in place: rebuilding the screen on every tick replaced the focused
  // draw button each time (a screen reader may re-announce it) and restarted every flap.
  function sweepColumn(column) {
    for (let row = 0; row < ROWS; row += 1) {
      const flap = ui.flaps[row * CELLS_PER_ROW + column];
      if (!flap) continue;
      flap.textContent = randomCharacter();
      flap.classList.remove('is-flipping');
      void flap.offsetWidth; // restart the one-shot flip
      flap.classList.add('is-flipping');
    }
  }

  // No custom accent leaves --rs-accent to the stylesheet, which points it at the Petrol accent token
  // (so Present mode gets the stage variant of it for free).
  function applyAccent() {
    if (ui.app) {
      if (state.accentColor) {
        ui.app.style.setProperty('--rs-accent', state.accentColor);
        ui.app.style.setProperty('--rs-accent-contrast', readableOn(state.accentColor));
      } else {
        ui.app.style.removeProperty('--rs-accent');
        ui.app.style.removeProperty('--rs-accent-contrast');
      }
    }
    if (ui.colourInput) ui.colourInput.value = state.accentColor ?? PETROL_ACCENT_HEX;
    if (ui.colourCode) ui.colourCode.textContent = state.accentColor?.toUpperCase() ?? 'PETROL';
    if (ui.accentReset) ui.accentReset.hidden = !state.accentColor;
    refreshSummaries();
  }

  // Says what the typed list is not doing (entries past the limit, nameless lines, weights outside
  // 1 to 1000), in a line under the list and, when it changes, through the live region. Nothing is
  // dropped silently. A full render passes `announce: false`: whatever caused it has already set
  // its own note, and a second message would replace that one in the polite live region.
  function showEntryProblems({ announce = true } = {}) {
    const found = describeEntryProblems(checkEntries(state.draft));
    const message = [weightNote, found].filter(Boolean).join(' ');
    if (ui.warning) {
      ui.warning.textContent = message;
      ui.warning.hidden = !message;
    }
    if (announce && found && found !== lastWarning) speak(found);
    lastWarning = found;
  }

  // CLEAR LIST, LOAD EXAMPLE LIST and a CSV import replace the whole list at once, so each keeps
  // what it replaced for one UNDO. It is dropped the moment anything else changes the list.
  function rememberForUndo(label) {
    state.undo = {
      label,
      draft: state.draft,
      history: state.history,
      winner: state.winner,
      drawn: state.drawn,
      // The note that offers this UNDO; it goes away when a different note replaces that one.
      note: undefined,
    };
  }

  function dropUndo() {
    if (!state.undo) return;
    state.undo = null;
    ui.undoButton?.remove();
    ui.undoButton = null;
  }

  function undoLast() {
    const saved = state.undo;
    if (!saved || state.spinning) return;
    state.undo = null;
    state.draft = saved.draft;
    state.entries = parseEntries(saved.draft);
    state.history = saved.history;
    state.winner = saved.winner;
    state.drawn = saved.drawn;
    state.reveal = null;
    setNote(`${saved.label} undone.`);
    persist();
    render();
    ui.drawButton?.focus();
  }

  // `undoable` marks a note that offers UNDO: the live region says so, and UNDO is shown only while
  // that note is. Any other note means the moment has passed.
  function setNote(text, { undoable = false } = {}) {
    if (state.undo && !undoable) dropUndo();
    state.note = text;
    if (undoable && state.undo) state.undo.note = text;
    speak(undoable ? `${text} Undo is available.` : text);
  }

  function speak(text) {
    announcements += 1;
    // An identical message (the same entry drawn twice) is only re-announced if the text changes.
    live.textContent = announcements % 2 ? text : `${text}\u00a0`;
  }

  function boardLabel() {
    if (state.spinning) return 'Drawing an entry';
    if (state.drawn) return `Selected entry: ${state.drawn}`;
    return 'Board ready. No entry drawn yet';
  }

  function persist() {
    saveCurrent(state, storage);
  }

  function updateEntries(draft) {
    // The winner is picked before the board starts spinning, so the list is frozen until it lands.
    if (state.spinning) return;
    state.draft = draft;
    state.entries = parseEntries(draft);
    state.reveal = null;
    persist();
    render();
  }

  function loadExample() {
    if (state.spinning) return;
    const example = DEMO_ENTRIES.join('\n');
    // Loading what is already there changes nothing, so it must not replace an earlier UNDO.
    const changes = state.draft !== example;
    if (changes) rememberForUndo('Load example list');
    updateEntries(example);
    setNote('Example list loaded.', {
      undoable: changes || state.undo?.note === 'Example list loaded.',
    });
    render();
  }

  function clearSession() {
    if (state.spinning) return;
    // Clearing an empty list changes nothing, so it must not replace an earlier UNDO.
    const changes = Boolean(state.draft || state.history.length || state.drawn);
    if (changes) rememberForUndo('Clear list');
    state.draft = '';
    state.entries = [];
    state.history = [];
    state.winner = 'READY';
    state.drawn = null;
    state.reveal = null;
    const cleared = 'List cleared. Ready for a new draw.';
    setNote(cleared, { undoable: changes || state.undo?.note === cleared });
    persist();
    render();
  }

  function drawRecord(entry, removed) {
    // `n` keeps counting past the 20 kept, so the newest row is not stuck at "20".
    const n = (state.history.at(-1)?.n ?? state.history.length) + 1;
    state.history = [
      ...state.history,
      {
        name: entry.name,
        weight: entry.weight,
        removed,
        n,
        at: new Date().toISOString(),
      },
    ].slice(-20);
  }

  function keepResult() {
    if (!state.reveal) return;
    setNote(`${state.winner} kept as the selected result.`);
    state.reveal = null;
    render();
    // The result panel (and the button that was just pressed) is gone: hand focus to the draw button.
    ui.drawButton?.focus();
  }

  // "Remove from list" on the result card: the winner stays in the list after a draw unless "Remove winners
  // after each draw" is on, and this takes just that entry out now. Only that entry's line goes.
  function removeWinner() {
    if (!state.reveal || state.reveal.removed || state.spinning) return;
    const { entry, index } = state.reveal;
    state.draft = removeDraftLine(state.draft, index);
    state.entries = parseEntries(state.draft);
    state.reveal = { ...state.reveal, removed: true };
    const last = state.history.at(-1);
    if (last) state.history = [...state.history.slice(0, -1), { ...last, removed: true }];
    setNote(`${entry.name} removed from the list.`);
    persist();
    render();
    ui.app?.querySelector('[data-focus-key="keep-result"]')?.focus();
  }

  function finishDraw(entry) {
    // Settle the spinner first: nothing below may leave the board stuck on DRAWING.
    state.spinning = false;
    clearInterval(tickHandle);
    tickHandle = null;
    const index = state.entries.indexOf(entry);
    state.winner = entry.name;
    state.drawn = entry.name;
    if (state.soundOn) ticker.tick(state.soundLevel);
    const removed = state.removeAfterDraw && index !== -1;
    if (removed) {
      // Only the drawn entry's line goes; a list longer than the limit keeps its extra lines, and the
      // next one in line takes the freed place.
      state.draft = removeDraftLine(state.draft, index);
      state.entries = parseEntries(state.draft);
    }
    drawRecord(entry, removed);
    state.reveal = { entry, removed, index };
    setNote(
      removed
        ? `${entry.name} selected and removed from the draw.`
        : `${entry.name} selected and kept in the draw.`,
    );
    persist();
    render();
  }

  function startDraw() {
    if (state.spinning) return;
    if (!state.entries.length) {
      setNote('Add at least one entry to draw.');
      render();
      return;
    }
    if (state.soundOn) ticker.unlock();
    dropUndo();
    const picked = state.entries[weightedIndex(state.entries)];
    const { duration, tickRate } = DRAW_PRESETS[state.drawPreset];
    const reduceMotion = prefersReducedMotion();
    state.spinning = true;
    state.reveal = null;
    setNote('Drawing an entry…');
    if (reduceMotion) state.winner = 'DRAWING';
    let tickCount = 0;
    tickHandle = window.setInterval(() => {
      if (state.soundOn) ticker.tick(state.soundLevel);
      // Reduced motion: the board holds still while the sound (if on) keeps its rhythm.
      if (reduceMotion) return;
      sweepColumn(tickCount % CELLS_PER_ROW);
      tickCount += 1;
    }, tickRate);
    finishHandle = window.setTimeout(() => finishDraw(picked), duration);
    render();
  }

  function redraw() {
    if (!state.reveal || state.spinning) return;
    const { entry, removed, index } = state.reveal;
    if (removed) {
      // The drawn entry was taken out of the list. Redrawing means that draw does not count, so it
      // goes back where it was and its history row is dropped, instead of being lost for good.
      state.draft = insertDraftLine(state.draft, index, entry);
      state.entries = parseEntries(state.draft);
      state.history = state.history.slice(0, -1);
    }
    state.reveal = null;
    state.winner = 'READY';
    state.drawn = null;
    persist();
    render();
    ui.drawButton?.focus();
    startDraw();
  }

  async function copyShareLink() {
    const encoded = encodeShare({
      draft: state.draft,
      removeAfterDraw: state.removeAfterDraw,
      drawPreset: state.drawPreset,
      soundLevel: state.soundLevel,
      boardTitle: state.boardTitle,
      accentColor: state.accentColor,
    });
    // A link the tool itself would refuse to open must not be reported as copied.
    if (!decodeShare(encoded)) {
      setNote('This list is too long to share as a link. Export it as a CSV instead.');
      render();
      return;
    }
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('draw', encoded);
    setNote(
      (await copyText(url.toString()))
        ? 'Share link copied. Anyone opening it gets this list and setting.'
        : 'Could not copy the link automatically. Please try again.',
    );
    render();
  }

  function icon(paths) {
    const svg = svgEl('svg', {
      width: '16',
      height: '16',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    paths.forEach((d) => svg.append(svgEl('path', { d })));
    return svg;
  }

  const ICONS = {
    sound: ['M4 9v6h4l5 4V5L8 9z', 'M16 9a4 4 0 0 1 0 6'],
    present: ['M3 4h18v12H3z', 'M8 20h8M12 16v4'],
    fullscreen: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
    link: [
      'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1',
      'M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
    ],
    chevron: ['M6 9l6 6 6-6'],
  };

  // A button with an icon in front of its label. On a phone the label is visually hidden (still its name).
  function iconButton(label, iconKey, className, onClick, attrs) {
    const node = button('', className, onClick, attrs);
    node.append(icon(ICONS[iconKey]), el('span', { className: 'rs-btn-label', text: label }));
    return node;
  }

  const fullscreenSupported = () =>
    Boolean(document.fullscreenEnabled && typeof page.requestFullscreen === 'function');

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await page.requestFullscreen();
    } catch {
      // The browser refused (no gesture, or a policy): Present mode still works without it.
    }
  }

  function setPresenting(on) {
    state.presenting = on;
    if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  function render() {
    const entriesFocused = document.activeElement === entriesField;
    const selection = [
      entriesField.selectionStart,
      entriesField.selectionEnd,
      entriesField.selectionDirection,
    ];
    const entriesScroll = entriesField.scrollTop;
    const weightsScroll = root.querySelector('.rs-weights')?.scrollTop ?? 0;
    withFocusPreservation(root, () => {
      const total = totalWeight();
      const app = el('main', {
        className: `random-selector${state.presenting ? ' is-presenting' : ''}`,
        attrs: {
          'data-surface': state.presenting ? 'stage' : 'paper',
          ...(state.accentColor
            ? {
                style: `--rs-accent:${state.accentColor};--rs-accent-contrast:${readableOn(state.accentColor)}`,
              }
            : {}),
        },
      });
      page.className = `rs-page${state.presenting ? ' is-presenting' : ''}`;
      page.dataset.surface = state.presenting ? 'stage' : 'paper';
      chrome.setPresenting(state.presenting);

      const drawButton = button(
        state.spinning ? 'Drawing' : 'Draw',
        'rs-draw-button action action-primary btn-bevel',
        startDraw,
        {
          'data-focus-key': 'draw',
          // aria-disabled, not disabled: a disabled button drops keyboard focus to <body> for
          // the whole spin and nothing gives it back. startDraw already ignores these clicks.
          ...(state.spinning || !state.entries.length ? { 'aria-disabled': 'true' } : {}),
        },
      );
      ui.drawButton = drawButton;

      // The tool's own controls sit on the breadcrumb row (the chrome's `controls` slot).
      const soundButton = iconButton(
        state.soundOn ? 'Sound on' : 'Sound off',
        'sound',
        'rs-tool-button action action-outline',
        () => {
          state.soundOn = !state.soundOn;
          persist();
          render();
        },
        // The label itself says the state ("Sound on"), so aria-pressed would read it twice.
        { 'data-focus-key': 'sound', 'data-on': String(state.soundOn) },
      );
      const controls = [soundButton];
      if (state.presenting) {
        if (fullscreenSupported()) {
          controls.push(
            iconButton(
              document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen',
              'fullscreen',
              'rs-tool-button action action-outline',
              () => {
                void toggleFullscreen();
              },
              { 'data-focus-key': 'fullscreen' },
            ),
          );
        }
        controls.push(
          button(
            'Exit (Esc)',
            'rs-tool-button action action-outline',
            () => {
              setPresenting(false);
              render();
            },
            { 'data-focus-key': 'present' },
          ),
        );
      } else {
        controls.push(
          iconButton(
            'Present',
            'present',
            'rs-tool-button action action-outline',
            () => {
              setPresenting(true);
              render();
            },
            { 'data-focus-key': 'present' },
          ),
        );
      }
      chrome.controls.replaceChildren(...controls);

      const lastDraw = state.history.at(-1)?.n;
      const boardState = state.spinning
        ? 'Drawing…'
        : state.drawn && lastDraw
          ? `Winner · draw ${lastDraw}`
          : 'Ready';
      const picker = el(
        'section',
        { className: 'rs-picker', attrs: { 'aria-labelledby': 'selector-heading' } },
        [
          el('h1', { id: 'selector-heading', className: 'rs-title', text: 'Random Selector' }),
          el('div', { className: 'rs-board-frame' }, [
            el('div', { className: 'rs-board-label' }, [
              el('span', { text: 'Seduh Score' }),
              (ui.titleCell = el('span', { text: state.boardTitle })),
            ]),
            splitFlapBoard(state.winner, boardLabel()),
            el('div', { className: 'rs-board-status' }, [
              el('span', { className: 'rs-board-state' }, [
                el('span', {
                  className: state.spinning ? 'status-live-dot' : 'rs-status-dot',
                  attrs: { 'aria-hidden': 'true' },
                }),
                el('span', { text: boardState }),
              ]),
              el('span', { text: 'Space to draw' }),
            ]),
          ]),
        ],
      );
      const autoRemove = el('input', {
        attrs: {
          type: 'checkbox',
          id: 'rs-remove-after',
          ...(state.spinning ? { disabled: '' } : {}),
        },
      });
      autoRemove.checked = state.removeAfterDraw;
      autoRemove.addEventListener('change', () => {
        state.removeAfterDraw = autoRemove.checked;
        persist();
        render();
      });
      picker.append(
        el('div', { className: 'rs-draw-row' }, [
          el('label', { className: 'rs-auto-remove', attrs: { for: 'rs-remove-after' } }, [
            autoRemove,
            el('span', { text: 'Remove winners after each draw' }),
          ]),
          el('div', { className: 'rs-draw-bar' }, [
            el('span', { className: 'rs-draw-hint', text: 'or press Space' }),
            drawButton,
          ]),
        ]),
      );
      // The status line (and its Undo) sits under the draw row, so it is seen whichever tab is open and in Present mode.
      ui.undoButton = null;
      if (state.note) {
        picker.append(
          el('div', { className: 'rs-note-row' }, [
            el('p', { className: 'rs-note', text: state.note }),
            ...(state.undo
              ? [
                  (ui.undoButton = button(
                    'Undo',
                    'rs-undo-button action action-outline',
                    undoLast,
                    {
                      'data-focus-key': 'undo',
                      'aria-label': `Undo: ${state.undo.label.toLowerCase()}`,
                    },
                  )),
                ]
              : []),
          ]),
        );
      }
      if (state.reveal) {
        const { entry, removed } = state.reveal;
        picker.append(
          el('section', { className: 'rs-reveal', attrs: { 'aria-labelledby': 'reveal-title' } }, [
            el('div', { className: 'rs-reveal-text' }, [
              el('p', {
                className: 'rs-kicker',
                text: lastDraw ? `Winner · draw ${lastDraw}` : 'Winner',
              }),
              el('h2', { id: 'reveal-title', text: entry.name }),
              el('p', {
                className: 'rs-reveal-copy',
                text: removed
                  ? `Removed from the list, so ${entry.name} cannot be drawn again.`
                  : `Still in the list, so ${entry.name} can be drawn again.`,
              }),
            ]),
            el('div', { className: 'rs-reveal-actions' }, [
              button('Keep result', 'rs-button action action-primary', keepResult, {
                'data-focus-key': 'keep-result',
              }),
              button('Discard & redraw', 'rs-button action action-outline', redraw, {
                'data-focus-key': 'redraw-result',
              }),
              ...(removed || state.presenting
                ? []
                : [
                    button('Remove from list', 'rs-button action action-outline', removeWinner, {
                      'data-focus-key': 'remove-winner',
                    }),
                  ]),
            ]),
          ]),
        );
      }
      const workspace = el('div', { className: 'rs-workspace' }, [picker]);
      if (!state.presenting) workspace.append(buildSide());
      app.append(workspace);
      ui.app = app;
      ui.flaps = [...app.querySelectorAll('.selector-flap')];
      host.replaceChildren(app);

      function buildSide() {
        if (entriesField.value !== state.draft) entriesField.value = state.draft;
        entriesField.disabled = state.spinning;
        const weights = el('div', { className: 'rs-weights' });
        ui.weightsList = weights;
        fillWeightRows(weights);
        const importInput = el('input', {
          attrs: { type: 'file', accept: '.csv,text/csv', hidden: '' },
        });
        importInput.addEventListener('change', async () => {
          const file = importInput.files?.[0];
          if (!file) return;
          if (file.size > MAX_IMPORT_BYTES) {
            importInput.value = '';
            setNote(
              'That file is too large to import (the limit is 1 MB). The list was left as it was.',
            );
            render();
            return;
          }
          const { entries, total } = entriesFromCsv(await file.text());
          // Choosing the same file again must fire `change` again.
          importInput.value = '';
          if (state.spinning) return;
          // A file with nothing usable in it must not wipe the list that is already loaded.
          if (!entries.length) {
            setNote('No entries found in that file. The list was left as it was.');
            render();
            return;
          }
          rememberForUndo('Import');
          updateEntries(formatEntries(entries));
          setNote(
            total > entries.length
              ? `Imported ${entries.length} of ${total} entries. The limit is ${MAX_ENTRIES}, so the rest were left out.`
              : `Imported ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}.`,
            { undoable: true },
          );
          render();
        });
        const importButton = button(
          'Import CSV',
          'rs-small-button action action-outline',
          () => importInput.click(),
          { 'data-focus-key': 'import', ...(state.spinning ? { disabled: '' } : {}) },
        );
        const exportButton = button(
          'Export CSV',
          'rs-small-button action action-outline',
          // The byte-order mark makes Excel read the file as UTF-8 (Malay diacritics, CJK names).
          () => downloadCsv('seduh-random-selector.csv', `\uFEFF${entriesToCsv(state.entries)}`),
          { 'data-focus-key': 'export' },
        );
        const exampleButton = button(
          'Load example list',
          'rs-small-button action action-outline',
          loadExample,
          { 'data-focus-key': 'load-example', ...(state.spinning ? { disabled: '' } : {}) },
        );
        const clearButton = button(
          'Clear list',
          'rs-small-button rs-quiet-danger action',
          clearSession,
          {
            'data-focus-key': 'clear',
            ...(state.spinning ? { disabled: '' } : {}),
          },
        );
        const shareButton = iconButton(
          'Copy share link',
          'link',
          'rs-share-button action action-outline',
          () => {
            void copyShareLink();
          },
          { 'data-focus-key': 'share' },
        );
        const entriesPanel = el(
          'div',
          {
            className: 'rs-panel-body',
            id: 'rs-panel-entries',
          },
          [
            el('div', { className: 'rs-field-group' }, [
              el('label', {
                className: 'rs-field-label',
                text: 'Names, one per line',
                attrs: { for: 'rs-entries' },
              }),
              entriesField,
              el('p', { className: 'rs-hint', attrs: { id: 'rs-entries-hint' } }, [
                document.createTextNode('Give a name more chances: write '),
                el('span', { className: 'rs-example', text: 'Bella | 2' }),
                document.createTextNode(' for double odds.'),
              ]),
              (ui.warning = el('p', {
                className: 'rs-warning',
                attrs: { id: 'rs-entries-warning' },
              })),
            ]),
            el('div', { className: 'rs-entry-actions' }, [
              importButton,
              exportButton,
              exampleButton,
              clearButton,
              importInput,
            ]),
            el('div', { className: 'rs-sections' }, [
              section('weights', 'Weights & odds', [
                (ui.totalCell = el('p', {
                  className: 'rs-weight-total',
                  text: `Total weight ${total}`,
                })),
                weights,
              ]),
              section('draw', 'Draw settings', [buildDrawSettings()]),
              section('look', 'Board look', [buildEventBranding()]),
            ]),
            el('div', { className: 'rs-share' }, [
              el('p', {
                className: 'rs-hint',
                text: 'Share this list and its settings with a link.',
              }),
              shareButton,
            ]),
          ],
        );

        const historyPanel = el(
          'div',
          {
            className: 'rs-panel-body rs-history-panel',
            id: 'rs-panel-history',
          },
          [
            el('h2', { text: 'History' }),
            state.history.length
              ? el(
                  'ol',
                  { className: 'rs-history' },
                  [...state.history].reverse().map((record, index) =>
                    el('li', {}, [
                      el('span', {
                        className: 'rs-history-n',
                        text: String(record.n ?? state.history.length - index).padStart(2, '0'),
                      }),
                      el('strong', { text: record.name }),
                      el('em', { text: record.removed ? 'removed' : 'kept' }),
                    ]),
                  ),
                )
              : el('p', {
                  className: 'empty',
                  text: 'No draws yet. Winners appear here, newest first.',
                  attrs: { 'data-kind': 'first-use' },
                }),
          ],
        );

        ui.countTab = el('span', { className: 'rs-count', text: String(state.entries.length) });
        ui.historyTab = el('span', { className: 'rs-count', text: String(state.history.length) });
        entriesPanel.hidden = state.tab !== 'entries';
        historyPanel.hidden = state.tab !== 'history';
        // The shared tablist (core/tablist.js): roving tabindex, arrow keys, one tabpanel. Switching tabs is
        // done in place, never with a re-render, so the entry list keeps its caret.
        const panels = el('div', { className: 'rs-panels' }, [entriesPanel, historyPanel]);
        const { list: tabs } = buildTablist({
          idBase: 'rs',
          label: 'Panel',
          selected: state.tab,
          panel: panels,
          tabs: [
            { id: 'entries', label: 'Entries', attrs: { 'data-focus-key': 'tab-entries' } },
            { id: 'history', label: 'History', attrs: { 'data-focus-key': 'tab-history' } },
          ],
          onSelect: (key) => {
            state.tab = key;
            entriesPanel.hidden = key !== 'entries';
            historyPanel.hidden = key !== 'history';
          },
        });
        tabs.querySelector('#rs-tab-entries').append(document.createTextNode(' '), ui.countTab);
        tabs.querySelector('#rs-tab-history').append(document.createTextNode(' '), ui.historyTab);
        showEntryProblems({ announce: false });
        return el('aside', { className: 'rs-side', attrs: { 'aria-label': 'List and settings' } }, [
          tabs,
          panels,
        ]);

        // A collapsible block: a button that says what it holds and what is set in it, over its body.
        function section(key, title, children) {
          const bodyId = `rs-section-${key}`;
          const summary = el('span', { className: 'rs-section-summary', text: summaryOf(key) });
          ui.summaries[key] = summary;
          const body = el('div', { className: 'rs-section-body', id: bodyId }, children);
          body.hidden = !state.open[key];
          const head = el(
            'button',
            {
              className: 'rs-section-head',
              attrs: {
                type: 'button',
                'aria-expanded': String(state.open[key]),
                'aria-controls': bodyId,
                'data-focus-key': `section-${key}`,
              },
            },
            [
              el('span', { className: 'rs-section-label' }, [
                el('span', { className: 'rs-section-title', text: title }),
                summary,
              ]),
              icon(ICONS.chevron),
            ],
          );
          head.addEventListener('click', () => {
            state.open[key] = !state.open[key];
            head.setAttribute('aria-expanded', String(state.open[key]));
            body.hidden = !state.open[key];
          });
          return el('div', { className: 'rs-section' }, [head, body]);
        }

        function buildDrawSettings() {
          const presetButtons = Object.entries(DRAW_PRESETS).map(([key, preset]) =>
            button(
              preset.label,
              `rs-preset-button${state.drawPreset === key ? ' is-selected' : ''}`,
              () => {
                state.drawPreset = validDrawPreset(key);
                persist();
                render();
              },
              {
                'aria-pressed': String(state.drawPreset === key),
                'data-focus-key': `preset-${key}`,
              },
            ),
          );
          const volumeText = el('span', {
            text: `Sound volume ${Math.round(state.soundLevel * 100)}%`,
          });
          const soundLevel = el('input', {
            className: 'rs-volume-range',
            attrs: {
              type: 'range',
              min: '0.1',
              max: '1',
              step: '0.1',
              value: String(state.soundLevel),
              'aria-label': 'Split-flap sound volume',
              'data-focus-key': 'volume',
              ...(state.soundOn ? {} : { disabled: '' }),
            },
          });
          soundLevel.addEventListener('input', () => {
            state.soundLevel = validSoundLevel(soundLevel.value);
            volumeText.textContent = `Sound volume ${Math.round(state.soundLevel * 100)}%`;
            persist();
            refreshSummaries();
          });
          return el('div', { className: 'rs-draw-settings' }, [
            el('p', {
              className: 'rs-group-label',
              id: 'draw-settings-title',
              text: 'Draw length',
            }),
            el(
              'div',
              {
                className: 'rs-preset-list',
                attrs: { role: 'group', 'aria-labelledby': 'draw-settings-title' },
              },
              presetButtons,
            ),
            el('label', { className: 'rs-volume-control' }, [volumeText, soundLevel]),
          ]);
        }

        function buildEventBranding() {
          const title = el('input', {
            className: 'rs-brand-title-input',
            attrs: {
              id: 'rs-board-title',
              type: 'text',
              maxlength: '32',
              value: state.boardTitle,
              'data-focus-key': 'board-title',
            },
          });
          title.addEventListener('change', () => {
            state.boardTitle = validBoardTitle(title.value);
            title.value = state.boardTitle;
            if (ui.titleCell) ui.titleCell.textContent = state.boardTitle;
            persist();
            refreshSummaries();
          });
          const color = el('input', {
            className: 'rs-color-input',
            attrs: {
              id: 'rs-accent-color',
              type: 'color',
              value: state.accentColor ?? PETROL_ACCENT_HEX,
              'data-focus-key': 'accent-color',
            },
          });
          ui.colourInput = color;
          color.addEventListener('change', () => {
            state.accentColor = validAccentColor(color.value);
            applyAccent();
            persist();
          });
          const reset = button(
            'Reset colour',
            'rs-small-button action action-outline',
            () => {
              state.accentColor = null;
              applyAccent();
              persist();
              // The button hides itself, so focus moves to the colour control it belongs to.
              color.focus();
            },
            { 'data-focus-key': 'accent-reset' },
          );
          reset.hidden = !state.accentColor;
          ui.accentReset = reset;
          return el('div', { className: 'rs-event-branding' }, [
            el(
              'label',
              {
                className: 'rs-brand-title-field',
                text: 'Board title',
                attrs: { for: 'rs-board-title' },
              },
              [title],
            ),
            el('label', { className: 'rs-color-field', attrs: { for: 'rs-accent-color' } }, [
              el('span', { text: 'Accent colour' }),
              color,
              (ui.colourCode = el('code', {
                text: state.accentColor?.toUpperCase() ?? 'PETROL',
              })),
            ]),
            el('div', { className: 'rs-color-reset' }, [reset]),
          ]);
        }
      }
    });
    entriesField.scrollTop = entriesScroll;
    if (entriesFocused && document.activeElement === entriesField) {
      entriesField.setSelectionRange(...selection);
    }
    const weightsList = root.querySelector('.rs-weights');
    if (weightsList) weightsList.scrollTop = weightsScroll;
  }

  // Space draws only when nothing else has focus: a focused button, link or field already owns the
  // key. No modifiers, no auto-repeat, and the page's own Space-to-scroll is left alone unless a draw
  // actually starts.
  function handleKeydown(event) {
    // Escape leaves Present mode, as it does any full-screen view.
    if (event.key === 'Escape' && state.presenting) {
      setPresenting(false);
      render();
      root.querySelector('[data-focus-key="present"]')?.focus();
      return;
    }
    if (event.code !== 'Space' || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (state.spinning || !state.entries.length) return;
    event.preventDefault();
    startDraw();
  }
  window.addEventListener('keydown', handleKeydown);
  // The browser's own Esc leaves Fullscreen without telling the page's keydown: redraw the button label.
  const onFullscreenChange = () => render();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  page.append(chrome.top, host, chrome.bottom, live);
  root.replaceChildren(page);
  render();
  return () => {
    window.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    clearInterval(tickHandle);
    clearTimeout(finishHandle);
  };
}

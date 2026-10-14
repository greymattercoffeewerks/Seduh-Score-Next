import { brandLockup, el, withFocusPreservation } from '../../core/dom.js';
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
// the name is still too long. The result panel below always shows the full name.
function boardCells(value) {
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
  const cells = rows.slice(0, ROWS).map((line) => {
    const characters = Array.from(line);
    return Array.from({ length: CELLS_PER_ROW }, (_, index) => characters[index] ?? ' ');
  });
  while (cells.length < ROWS) cells.push(Array(CELLS_PER_ROW).fill(' '));
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
  };
  const ticker = createTicker();
  let tickHandle = null;
  let finishHandle = null;

  // render() tears the whole screen down, so anything a screen reader must hear lives outside
  // that subtree: a live region created inside it is replaced before it can be announced.
  const live = el('div', {
    className: 'sr-only',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  });
  const host = el('div');
  let announcements = 0;

  // The entry list is one long-lived node, moved into each fresh tree, so its caret, scroll
  // position and value survive the re-render that every keystroke triggers.
  const entriesField = el('textarea', {
    className: 'rs-textarea',
    attrs: { id: 'rs-entries', rows: '10', spellcheck: 'false', 'data-focus-key': 'entries' },
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
    countTop: null,
    countPanel: null,
    weightsList: null,
    colourInput: null,
    accentReset: null,
    oddsFills: [],
    warning: null,
    undoButton: null,
  };
  let lastWarning = '';

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
    if (ui.totalCell) ui.totalCell.textContent = `${total} TOTAL WEIGHT`;
    if (entriesField.value !== state.draft) entriesField.value = state.draft;
    showEntryProblems();
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
        const next = Number(field.value);
        if (Number.isFinite(next) && next >= 1) entry.weight = Math.min(1000, Math.round(next));
        field.value = String(entry.weight);
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
    state.draft = entriesField.value;
    state.entries = parseEntries(state.draft);
    state.reveal = null;
    persist();
    const count = state.entries.length;
    if (ui.countTop) ui.countTop.textContent = `${count} ENTRIES`;
    if (ui.countPanel) ui.countPanel.textContent = `${count} loaded`;
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
  }

  // Says what the typed list is not doing (entries past the limit, weights outside 1 to 1000), in a
  // line under the list and, when it changes, through the live region. Nothing is dropped silently.
  function showEntryProblems() {
    const message = describeEntryProblems(checkEntries(state.draft));
    if (ui.warning) {
      ui.warning.textContent = message;
      ui.warning.hidden = !message;
    }
    if (message && message !== lastWarning) speak(message);
    lastWarning = message;
  }

  // CLEAR SESSION, LOAD EXAMPLE LIST and a CSV import replace the whole list at once, so each keeps
  // what it replaced for one UNDO. It is dropped the moment anything else changes the list.
  function rememberForUndo(label) {
    state.undo = {
      label,
      draft: state.draft,
      history: state.history,
      winner: state.winner,
      drawn: state.drawn,
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

  function setNote(text) {
    state.note = text;
    speak(text);
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
    rememberForUndo('Load example list');
    updateEntries(DEMO_ENTRIES.join('\n'));
    setNote('Example list loaded.');
    render();
  }

  function clearSession() {
    if (state.spinning) return;
    rememberForUndo('Clear session');
    state.draft = '';
    state.entries = [];
    state.history = [];
    state.winner = 'READY';
    state.drawn = null;
    state.reveal = null;
    setNote('Session cleared. Ready for a new draw.');
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
    try {
      await navigator.clipboard.writeText(url.toString());
      setNote('Share link copied. Anyone opening it gets this list and setting.');
    } catch {
      setNote('Could not copy the link automatically. Please try again.');
    }
    render();
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
      const drawButton = button(
        state.spinning ? 'DRAWING' : 'DRAW ENTRY',
        'rs-draw-button cut-md',
        startDraw,
        {
          'data-focus-key': 'draw',
          // aria-disabled, not disabled: a disabled button drops keyboard focus to <body> for
          // the whole spin and nothing gives it back. startDraw already ignores these clicks.
          ...(state.spinning || !state.entries.length ? { 'aria-disabled': 'true' } : {}),
        },
      );
      ui.drawButton = drawButton;
      const soundButton = button(
        state.soundOn ? 'SOUND ON' : 'SOUND OFF',
        'rs-text-button',
        () => {
          state.soundOn = !state.soundOn;
          persist();
          render();
        },
        // The label itself says the state ("SOUND ON"), so aria-pressed would read it twice.
        { 'data-focus-key': 'sound', 'data-on': String(state.soundOn) },
      );
      const presentButton = button(
        state.presenting ? 'EXIT DISPLAY' : 'PRESENT',
        'rs-text-button',
        () => {
          state.presenting = !state.presenting;
          render();
        },
        { 'data-focus-key': 'present' },
      );
      app.append(
        el('header', { className: 'rs-topbar' }, [
          el('a', { className: 'rs-brand', attrs: { href: '/' } }, [brandLockup()]),
          el('div', { className: 'rs-top-actions' }, [
            (ui.countTop = el('span', {
              className: 'rs-entry-count',
              text: `${state.entries.length} ENTRIES`,
            })),
            soundButton,
            presentButton,
          ]),
        ]),
      );
      const picker = el(
        'section',
        { className: 'rs-picker', attrs: { 'aria-labelledby': 'selector-heading' } },
        [
          el('div', { className: 'rs-section-line' }, [
            el('h1', { id: 'selector-heading', text: 'RANDOM SELECTOR' }),
          ]),
          el('div', { className: 'rs-board-frame cut-lg' }, [
            el('div', { className: 'rs-board-label' }, [
              el('span', { text: 'SEDUH SCORE' }),
              (ui.titleCell = el('span', { text: state.boardTitle })),
            ]),
            splitFlapBoard(state.winner, boardLabel()),
            el('div', { className: 'rs-board-status' }, [
              el('span', { className: 'rs-board-state' }, [
                el('span', {
                  className: state.spinning ? 'status-live-dot' : 'rs-status-dot',
                  attrs: { 'aria-hidden': 'true' },
                }),
                el('span', { text: state.spinning ? 'STATUS: DRAWING' : 'STATUS: READY' }),
              ]),
              el('span', { text: 'SPACE TO DRAW' }),
            ]),
          ]),
          el('div', { className: 'rs-draw-actions' }, [drawButton]),
        ],
      );
      if (state.reveal) {
        picker.append(
          el('section', { className: 'rs-reveal', attrs: { 'aria-labelledby': 'reveal-title' } }, [
            el('p', { className: 'rs-kicker', text: 'DRAW COMPLETE' }),
            el('h2', { id: 'reveal-title', text: state.reveal.entry.name }),
            el('p', {
              className: 'rs-reveal-copy',
              text: state.reveal.removed
                ? 'Selected and removed automatically from the draw.'
                : 'Selected and kept in the draw.',
            }),
            el('div', { className: 'rs-reveal-actions' }, [
              button('KEEP RESULT', 'rs-button rs-button-primary cut-sm', keepResult, {
                'data-focus-key': 'keep-result',
              }),
              button('REDRAW', 'rs-button rs-button-outline', redraw, {
                'data-focus-key': 'redraw-result',
              }),
            ]),
          ]),
        );
      }
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
        el('label', { className: 'rs-auto-remove', attrs: { for: 'rs-remove-after' } }, [
          autoRemove,
          el('span', { text: 'Remove every selected entry automatically' }),
        ]),
      );
      app.append(picker);
      if (!state.presenting) app.append(buildControls());
      app.append(
        el('footer', { className: 'rs-footer' }, [
          el('span', { text: 'SEDUH SCORE / RANDOM SELECTOR' }),
          el('span', { text: 'SPLIT-FLAP EDITION' }),
        ]),
      );
      ui.app = app;
      ui.flaps = [...app.querySelectorAll('.selector-flap')];
      host.replaceChildren(app);

      function buildControls() {
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
          );
          render();
        });
        const importButton = button('IMPORT CSV', 'rs-link-button', () => importInput.click(), {
          'data-focus-key': 'import',
          ...(state.spinning ? { disabled: '' } : {}),
        });
        const exportButton = button(
          'EXPORT LIST',
          'rs-link-button',
          // The byte-order mark makes Excel read the file as UTF-8 (Malay diacritics, CJK names).
          () => downloadCsv('seduh-random-selector.csv', `\uFEFF${entriesToCsv(state.entries)}`),
          { 'data-focus-key': 'export' },
        );
        const shareButton = button(
          'COPY SHARE LINK',
          'rs-link-button',
          () => {
            void copyShareLink();
          },
          { 'data-focus-key': 'share' },
        );
        ui.undoButton = null;
        const controls = el('section', { className: 'rs-controls' }, [
          el('article', { className: 'rs-entry-panel' }, [
            el('p', { className: 'rs-kicker', text: 'ENTRY LIST' }),
            el('div', { className: 'rs-panel-heading' }, [
              el('h2', { text: 'Names in the draw' }),
              (ui.countPanel = el('span', { text: `${state.entries.length} loaded` })),
            ]),
            el('label', {
              className: 'rs-field-label',
              text: 'One entry per line · add | 2 for double weight',
              attrs: { for: 'rs-entries' },
            }),
            entriesField,
            (ui.warning = el('p', { className: 'rs-warning' })),
            el('div', { className: 'rs-weight-heading' }, [
              el('span', { text: 'WEIGHTS & ODDS' }),
              (ui.totalCell = el('span', { text: `${total} TOTAL WEIGHT` })),
            ]),
            weights,
            buildDrawSettings(),
            buildEventBranding(),
            el('div', { className: 'rs-entry-actions' }, [
              button('LOAD EXAMPLE LIST', 'rs-link-button', loadExample, {
                'data-focus-key': 'load-example',
                ...(state.spinning ? { disabled: '' } : {}),
              }),
              button('CLEAR SESSION', 'rs-link-button', clearSession, {
                'data-focus-key': 'clear',
                ...(state.spinning ? { disabled: '' } : {}),
              }),
            ]),
            el('div', { className: 'rs-entry-actions rs-transfer-actions' }, [
              importButton,
              exportButton,
              shareButton,
              importInput,
            ]),
            ...(state.note
              ? [
                  el('div', { className: 'rs-note-row' }, [
                    el('p', { className: 'rs-note', text: state.note }),
                    ...(state.undo
                      ? [
                          (ui.undoButton = button('UNDO', 'rs-link-button', undoLast, {
                            'data-focus-key': 'undo',
                          })),
                        ]
                      : []),
                  ]),
                ]
              : []),
          ]),
          el('aside', { className: 'rs-history-panel' }, [
            el('p', { className: 'rs-kicker', text: 'DRAW HISTORY' }),
            el('h2', { text: 'A clear record of every draw.' }),
            state.history.length
              ? el(
                  'ol',
                  { className: 'rs-history' },
                  state.history
                    .slice(-6)
                    .reverse()
                    .map((record, index) =>
                      el('li', {}, [
                        el('span', {
                          text: String(record.n ?? state.history.length - index).padStart(2, '0'),
                        }),
                        el('strong', { text: record.name }),
                        el('em', { text: record.removed ? 'removed' : 'kept' }),
                      ]),
                    ),
                )
              : el('p', {
                  className: 'rs-history-empty',
                  text: 'No draws yet. The result controls will keep your record accurate.',
                }),
          ]),
        ]);
        showEntryProblems();
        return controls;

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
            text: `SOUND VOLUME ${Math.round(state.soundLevel * 100)}%`,
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
            volumeText.textContent = `SOUND VOLUME ${Math.round(state.soundLevel * 100)}%`;
            persist();
          });
          return el(
            'section',
            { className: 'rs-draw-settings', attrs: { 'aria-labelledby': 'draw-settings-title' } },
            [
              el('div', { className: 'rs-weight-heading' }, [
                el('span', { id: 'draw-settings-title', text: 'DRAW SETTINGS' }),
                el('span', { text: `${DRAW_PRESETS[state.drawPreset].duration / 1000}s SPIN` }),
              ]),
              el(
                'div',
                {
                  className: 'rs-preset-list',
                  attrs: { role: 'group', 'aria-label': 'Draw duration' },
                },
                presetButtons,
              ),
              el('label', { className: 'rs-volume-control' }, [volumeText, soundLevel]),
            ],
          );
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
            'USE PETROL ACCENT',
            'rs-link-button',
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
          return el(
            'section',
            {
              className: 'rs-event-branding',
              attrs: { 'aria-labelledby': 'event-branding-title' },
            },
            [
              el('div', { className: 'rs-weight-heading' }, [
                el('span', { id: 'event-branding-title', text: 'EVENT BRANDING' }),
                el('span', { text: 'SAVED WITH SHARE LINK' }),
              ]),
              el(
                'label',
                {
                  className: 'rs-brand-title-field',
                  text: 'BOARD TITLE',
                  attrs: { for: 'rs-board-title' },
                },
                [title],
              ),
              el('label', { className: 'rs-color-field', attrs: { for: 'rs-accent-color' } }, [
                el('span', { text: 'ACCENT COLOUR' }),
                color,
                (ui.colourCode = el('code', {
                  text: state.accentColor?.toUpperCase() ?? 'PETROL',
                })),
              ]),
              el('div', { className: 'rs-color-reset' }, [reset]),
            ],
          );
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
      state.presenting = false;
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
  root.replaceChildren(host, live);
  render();
  return () => {
    window.removeEventListener('keydown', handleKeydown);
    clearInterval(tickHandle);
    clearTimeout(finishHandle);
  };
}

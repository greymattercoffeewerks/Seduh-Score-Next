import { brandLockup, el, withFocusPreservation } from '../../core/dom.js';
import {
  decodeShare,
  DEMO_ENTRIES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_BOARD_TITLE,
  DRAW_PRESETS,
  encodeShare,
  formatEntries,
  loadSaved,
  parseEntries,
  saveCurrent,
  validDrawPreset,
  validAccentColor,
  validBoardTitle,
  validSoundLevel,
  weightedIndex,
} from './randomSelector.js';

const CELLS_PER_ROW = 14;
const ROWS = 4;
const ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function button(text, className, onClick, attrs = {}) {
  const node = el('button', { className, text, attrs: { type: 'button', ...attrs } });
  node.addEventListener('click', onClick);
  return node;
}

function boardRows(value) {
  const clean = String(value)
    .toUpperCase()
    .slice(0, CELLS_PER_ROW * ROWS);
  return Array.from({ length: ROWS }, (_, rowIndex) =>
    clean
      .slice(rowIndex * CELLS_PER_ROW, (rowIndex + 1) * CELLS_PER_ROW)
      .padEnd(CELLS_PER_ROW, ' '),
  );
}

// The board is a picture of the result: its name comes from the draw state, never from the
// characters flickering across the flaps, which would read out as 56 single letters.
function splitFlapBoard(value, spinning, label) {
  return el(
    'div',
    { className: 'selector-board', attrs: { role: 'img', 'aria-label': label } },
    boardRows(value).map((row) =>
      el(
        'div',
        { className: 'selector-flap-row' },
        [...row].map((character, index) =>
          el('span', {
            className: `selector-flap${spinning ? ' is-spinning' : ''}`,
            text: character,
            attrs: { style: `--flap-delay:${index * 26}ms` },
          }),
        ),
      ),
    ),
  );
}

function randomBoardValue() {
  return Array.from(
    { length: 3 + Math.floor(Math.random() * 25) },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  ).join('');
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

  return {
    unlock() {
      ensure();
      if (!sample) return;
      sample.muted = true;
      sample
        .play()
        .then(() => {
          sample.pause();
          sample.currentTime = 0;
          sample.muted = false;
        })
        .catch(() => {
          sample.muted = false;
          sampleAvailable = false;
        });
    },
    tick(volume) {
      const now = performance.now();
      if (sampleAvailable && sample && now - lastSampleAt >= 105) {
        lastSampleAt = now;
        sample.volume = Math.min(1, volume * 1.5);
        sample.currentTime = 0;
        sample.play().catch(() => {
          sampleAvailable = false;
          syntheticTick(volume);
        });
        return;
      }
      if (!sampleAvailable) syntheticTick(volume);
    },
  };
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function csvEntries(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.split(',')[0]?.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
}

function accentContrast(color) {
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 170 ? '#0b0e10' : '#ffffff';
}

export function mountRandomSelector(root, { storage = window.localStorage } = {}) {
  const shared = decodeShare(new URLSearchParams(window.location.search).get('draw'));
  const saved = shared ? null : loadSaved(storage);
  const initialDraft = shared?.draft ?? saved?.draft ?? DEMO_ENTRIES.join('\n');
  const state = {
    draft: initialDraft,
    entries: parseEntries(initialDraft),
    removeAfterDraw: shared?.removeAfterDraw ?? saved?.removeAfterDraw ?? false,
    history: shared ? [] : (saved?.history ?? []),
    drawPreset: shared?.drawPreset ?? saved?.drawPreset ?? 'standard',
    soundLevel: shared?.soundLevel ?? saved?.soundLevel ?? 0.6,
    boardTitle: shared?.boardTitle ?? saved?.boardTitle ?? DEFAULT_BOARD_TITLE,
    accentColor: shared?.accentColor ?? saved?.accentColor ?? DEFAULT_ACCENT_COLOR,
    winner: 'READY',
    drawn: null,
    spinning: false,
    soundOn: saved?.soundOn ?? true,
    reveal: null,
    note: shared ? 'Shared draw loaded. Edit it, then copy a fresh link when ready.' : '',
    presenting: false,
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
  entriesField.addEventListener('input', () => updateEntries(entriesField.value));

  // Fields that commit on blur (weights, title, colour) or fire continuously (volume) must not
  // trigger a rebuild: it would replace the very control being used, so a Tab lands on <body>, a
  // slider drag is dropped and the click that caused the blur is swallowed. They update in place.
  const ui = { app: null, titleCell: null, percentCells: [], totalCell: null, colourCode: null };

  function totalWeight() {
    return state.entries.reduce((sum, entry) => sum + entry.weight, 0);
  }

  function refreshWeightReadouts() {
    const total = totalWeight();
    state.entries.forEach((entry, index) => {
      const cell = ui.percentCells[index];
      if (cell) cell.textContent = `${((entry.weight / total) * 100).toFixed(1)}%`;
    });
    if (ui.totalCell) ui.totalCell.textContent = `${total} TOTAL WEIGHT`;
    if (entriesField.value !== state.draft) entriesField.value = state.draft;
  }

  function setNote(text) {
    state.note = text;
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

  function clearSession() {
    if (state.spinning) return;
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
    state.history = [
      ...state.history,
      {
        name: entry.name,
        weight: entry.weight,
        removed,
        at: new Date().toISOString(),
      },
    ].slice(-20);
  }

  function keepResult() {
    if (!state.reveal) return;
    setNote(`${state.winner} kept as the selected result.`);
    state.reveal = null;
    render();
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
      state.entries = state.entries.filter((_, entryIndex) => entryIndex !== index);
      state.draft = formatEntries(state.entries);
    }
    drawRecord(entry, removed);
    state.reveal = { entry, removed };
    setNote(
      removed
        ? `${entry.name} selected and removed from the draw.`
        : `${entry.name} selected and kept in the draw.`,
    );
    persist();
    render();
  }

  function startDraw() {
    if (state.spinning || !state.entries.length) return;
    if (state.soundOn) ticker.unlock();
    const picked = state.entries[weightedIndex(state.entries)];
    const { duration, tickRate } = DRAW_PRESETS[state.drawPreset];
    const reduceMotion = prefersReducedMotion();
    state.spinning = true;
    state.reveal = null;
    setNote('Drawing an entry…');
    if (reduceMotion) state.winner = 'DRAWING';
    tickHandle = window.setInterval(() => {
      if (state.soundOn) ticker.tick(state.soundLevel);
      // Reduced motion: the board holds still while the sound (if on) keeps its rhythm.
      if (reduceMotion) return;
      state.winner = randomBoardValue();
      render();
    }, tickRate);
    finishHandle = window.setTimeout(() => finishDraw(picked), duration);
    render();
  }

  function redraw() {
    if (!state.reveal) return;
    state.reveal = null;
    state.winner = 'READY';
    state.drawn = null;
    render();
    startDraw();
  }

  async function copyShareLink() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set(
      'draw',
      encodeShare({
        draft: state.draft,
        removeAfterDraw: state.removeAfterDraw,
        drawPreset: state.drawPreset,
        soundLevel: state.soundLevel,
        boardTitle: state.boardTitle,
        accentColor: state.accentColor,
      }),
    );
    try {
      await navigator.clipboard.writeText(url.toString());
      setNote('Share link copied. Anyone opening it gets this list and setting.');
    } catch {
      setNote('Could not copy the link automatically. Please try again.');
    }
    render();
  }

  function download(filename, contents) {
    const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
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
          style: `--rs-accent:${state.accentColor};--rs-accent-contrast:${accentContrast(state.accentColor)}`,
        },
      });
      const drawButton = button(
        state.spinning ? 'DRAWING' : 'DRAW ENTRY',
        'rs-draw-button',
        startDraw,
        {
          'data-focus-key': 'draw',
          // aria-disabled, not disabled: a disabled button drops keyboard focus to <body> for
          // the whole spin and nothing gives it back. startDraw already ignores these clicks.
          ...(state.spinning || !state.entries.length ? { 'aria-disabled': 'true' } : {}),
        },
      );
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
            el('span', { className: 'rs-entry-count', text: `${state.entries.length} ENTRIES` }),
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
            el('span', { text: 'LIVE' }),
          ]),
          el('div', { className: 'rs-board-frame' }, [
            el('div', { className: 'rs-board-label' }, [
              el('span', { text: 'SEDUH SCORE' }),
              (ui.titleCell = el('span', { text: state.boardTitle })),
            ]),
            splitFlapBoard(state.winner, state.spinning, boardLabel()),
            el('div', { className: 'rs-board-status' }, [
              el('span', { text: state.spinning ? 'STATUS: DRAWING' : 'STATUS: READY' }),
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
              button('KEEP RESULT', 'rs-button rs-button-primary', keepResult, {
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
      host.replaceChildren(app);

      function buildControls() {
        if (entriesField.value !== state.draft) entriesField.value = state.draft;
        entriesField.disabled = state.spinning;
        ui.percentCells = [];
        const weights = el(
          'div',
          { className: 'rs-weights' },
          state.entries.map((entry, index) => {
            const field = el('input', {
              className: 'rs-weight-input',
              attrs: {
                type: 'number',
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
              if (Number.isFinite(next) && next >= 1)
                entry.weight = Math.min(1000, Math.round(next));
              field.value = String(entry.weight);
              state.draft = formatEntries(state.entries);
              persist();
              refreshWeightReadouts();
            });
            const percent = el('span', { text: `${((entry.weight / total) * 100).toFixed(1)}%` });
            ui.percentCells[index] = percent;
            return el('div', { className: 'rs-weight-row' }, [
              el('span', { text: entry.name }),
              field,
              percent,
            ]);
          }),
        );
        const importInput = el('input', {
          attrs: { type: 'file', accept: '.csv,text/csv', hidden: '' },
        });
        importInput.addEventListener('change', async () => {
          const file = importInput.files?.[0];
          if (!file) return;
          const names = csvEntries(await file.text());
          if (state.spinning) return;
          if (/^(name|names|entry|entries|participant|participants)$/i.test(names[0] ?? ''))
            names.shift();
          updateEntries(names.slice(0, 80).join('\n'));
          setNote(`Imported ${names.length} entries.`);
          render();
        });
        const importButton = button('IMPORT CSV', 'rs-link-button', () => importInput.click(), {
          'data-focus-key': 'import',
          ...(state.spinning ? { disabled: '' } : {}),
        });
        const exportButton = button(
          'EXPORT LIST',
          'rs-link-button',
          () =>
            download(
              'seduh-random-selector.csv',
              `Entry,Weight\r\n${state.entries.map((entry) => `"${entry.name.replaceAll('"', '""')}",${entry.weight}`).join('\r\n')}`,
            ),
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
        return el('section', { className: 'rs-controls' }, [
          el('article', { className: 'rs-entry-panel' }, [
            el('p', { className: 'rs-kicker', text: 'ENTRY LIST' }),
            el('div', { className: 'rs-panel-heading' }, [
              el('h2', { text: 'Names in the draw' }),
              el('span', { text: `${state.entries.length} loaded` }),
            ]),
            el('label', {
              className: 'rs-field-label',
              text: 'One entry per line · add | 2 for double weight',
              attrs: { for: 'rs-entries' },
            }),
            entriesField,
            el('div', { className: 'rs-weight-heading' }, [
              el('span', { text: 'WEIGHTS & ODDS' }),
              (ui.totalCell = el('span', { text: `${total} TOTAL WEIGHT` })),
            ]),
            weights,
            buildDrawSettings(),
            buildEventBranding(),
            el('div', { className: 'rs-entry-actions' }, [
              button(
                'LOAD EXAMPLE LIST',
                'rs-link-button',
                () => updateEntries(DEMO_ENTRIES.join('\n')),
                { 'data-focus-key': 'load-example', ...(state.spinning ? { disabled: '' } : {}) },
              ),
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
            ...(state.note ? [el('p', { className: 'rs-note', text: state.note })] : []),
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
                        el('span', { text: String(state.history.length - index).padStart(2, '0') }),
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
              value: state.accentColor,
              'data-focus-key': 'accent-color',
            },
          });
          color.addEventListener('change', () => {
            state.accentColor = validAccentColor(color.value);
            ui.app?.style.setProperty('--rs-accent', state.accentColor);
            ui.app?.style.setProperty('--rs-accent-contrast', accentContrast(state.accentColor));
            if (ui.colourCode) ui.colourCode.textContent = state.accentColor.toUpperCase();
            persist();
          });
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
                (ui.colourCode = el('code', { text: state.accentColor.toUpperCase() })),
              ]),
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

  function handleKeydown(event) {
    if (
      event.code === 'Space' &&
      !['TEXTAREA', 'INPUT', 'BUTTON'].includes(document.activeElement?.tagName)
    ) {
      event.preventDefault();
      startDraw();
    }
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

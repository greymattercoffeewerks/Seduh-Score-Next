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
  const clean = String(value).toUpperCase().slice(0, CELLS_PER_ROW * ROWS);
  return Array.from({ length: ROWS }, (_, rowIndex) => clean.slice(rowIndex * CELLS_PER_ROW, (rowIndex + 1) * CELLS_PER_ROW).padEnd(CELLS_PER_ROW, ' '));
}

function splitFlapBoard(value, spinning) {
  return el('div', { className: 'selector-board', attrs: { 'aria-label': `Selected entry: ${value}` } },
    boardRows(value).map((row) => el('div', { className: 'selector-flap-row' },
      [...row].map((character, index) => el('span', {
        className: `selector-flap${spinning ? ' is-spinning' : ''}`,
        text: character,
        attrs: { style: `--flap-delay:${index * 26}ms` },
      })),
    )),
  );
}

function randomBoardValue() {
  return Array.from({ length: 3 + Math.floor(Math.random() * 25) }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
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
      sample.play().then(() => {
        sample.pause();
        sample.currentTime = 0;
        sample.muted = false;
      }).catch(() => {
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

function csvEntries(source) {
  return source.split(/\r?\n/).map((line) => line.split(',')[0]?.replace(/^"|"$/g, '').trim()).filter(Boolean);
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
    history: shared ? [] : saved?.history ?? [],
    drawPreset: shared?.drawPreset ?? saved?.drawPreset ?? 'standard',
    soundLevel: shared?.soundLevel ?? saved?.soundLevel ?? 0.6,
    boardTitle: shared?.boardTitle ?? saved?.boardTitle ?? DEFAULT_BOARD_TITLE,
    accentColor: shared?.accentColor ?? saved?.accentColor ?? DEFAULT_ACCENT_COLOR,
    winner: 'READY', spinning: false, soundOn: saved?.soundOn ?? true, reveal: null,
    note: shared ? 'Shared draw loaded. Edit it, then copy a fresh link when ready.' : '', presenting: false,
  };
  const ticker = createTicker();
  let tickHandle = null;
  let finishHandle = null;

  function persist() { saveCurrent(state, storage); }

  function updateEntries(draft) {
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
    state.reveal = null;
    state.note = 'Session cleared. Ready for a new draw.';
    persist();
    render();
  }

  function drawRecord(entry, removed) {
    state.history = [...state.history, {
      name: entry.name, weight: entry.weight, removed, at: new Date().toISOString(),
    }].slice(-20);
  }

  function keepResult() {
    if (!state.reveal) return;
    state.note = `${state.winner} kept as the selected result.`;
    state.reveal = null;
    render();
  }

  function finishDraw(index) {
    const entry = state.entries[index];
    if (!entry) return;
    state.winner = entry.name;
    state.spinning = false;
    clearInterval(tickHandle);
    tickHandle = null;
    if (state.soundOn) ticker.tick(state.soundLevel);
    const removed = state.removeAfterDraw;
    if (removed) {
      state.entries = state.entries.filter((_, entryIndex) => entryIndex !== index);
      state.draft = formatEntries(state.entries);
    }
    drawRecord(entry, removed);
    state.reveal = { entry, removed };
    state.note = removed ? `${entry.name} selected and removed from the draw.` : `${entry.name} selected and kept in the draw.`;
    persist();
    render();
  }

  function startDraw() {
    if (state.spinning || !state.entries.length) return;
    if (state.soundOn) ticker.unlock();
    const index = weightedIndex(state.entries);
    state.spinning = true;
    state.reveal = null;
    state.note = 'Drawing an entry…';
    tickHandle = window.setInterval(() => {
      state.winner = randomBoardValue();
      if (state.soundOn) ticker.tick(state.soundLevel);
      render();
    }, DRAW_PRESETS[state.drawPreset].tickRate);
    finishHandle = window.setTimeout(() => finishDraw(index), DRAW_PRESETS[state.drawPreset].duration);
    render();
  }

  function redraw() {
    if (!state.reveal) return;
    state.reveal = null;
    state.winner = 'READY';
    render();
    startDraw();
  }

  async function copyShareLink() {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('draw', encodeShare({
      draft: state.draft,
      removeAfterDraw: state.removeAfterDraw,
      drawPreset: state.drawPreset,
      soundLevel: state.soundLevel,
      boardTitle: state.boardTitle,
      accentColor: state.accentColor,
    }));
    try {
      await navigator.clipboard.writeText(url.toString());
      state.note = 'Share link copied. Anyone opening it gets this list and setting.';
    } catch {
      state.note = 'Could not copy the link automatically. Please try again.';
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
    withFocusPreservation(root, () => {
      const totalWeight = state.entries.reduce((sum, entry) => sum + entry.weight, 0);
      const app = el('main', {
        className: `random-selector${state.presenting ? ' is-presenting' : ''}`,
        attrs: {
          'data-surface': state.presenting ? 'stage' : 'paper',
          style: `--rs-accent:${state.accentColor};--rs-accent-contrast:${accentContrast(state.accentColor)}`,
        },
      });
      const drawButton = button(state.spinning ? 'DRAWING' : 'DRAW ENTRY', 'rs-draw-button', startDraw, { 'data-focus-key': 'draw', ...(state.spinning || !state.entries.length ? { disabled: '' } : {}) });
      const soundButton = button(state.soundOn ? 'SOUND ON' : 'SOUND OFF', 'rs-text-button', () => { state.soundOn = !state.soundOn; persist(); render(); }, { 'aria-pressed': String(state.soundOn) });
      const presentButton = button(state.presenting ? 'EXIT DISPLAY' : 'PRESENT', 'rs-text-button', () => { state.presenting = !state.presenting; render(); });
      app.append(el('header', { className: 'rs-topbar' }, [
        el('a', { className: 'rs-brand', attrs: { href: '/' } }, [brandLockup()]),
        el('div', { className: 'rs-top-actions' }, [el('span', { className: 'rs-entry-count', text: `${state.entries.length} ENTRIES` }), soundButton, presentButton]),
      ]));
      const picker = el('section', { className: 'rs-picker', attrs: { 'aria-labelledby': 'selector-heading' } }, [
        el('div', { className: 'rs-section-line' }, [el('span', { id: 'selector-heading', text: 'RANDOM SELECTOR' }), el('span', { text: 'LIVE' })]),
        el('div', { className: 'rs-board-frame' }, [
          el('div', { className: 'rs-board-label' }, [el('span', { text: 'SEDUH SCORE' }), el('span', { text: state.boardTitle })]),
          splitFlapBoard(state.winner, state.spinning),
          el('div', { className: 'rs-board-status' }, [el('span', { text: state.spinning ? 'STATUS: DRAWING' : 'STATUS: READY' }), el('span', { text: 'SPACE TO DRAW' })]),
        ]),
        el('div', { className: 'rs-draw-actions' }, [drawButton]),
      ]);
      if (state.reveal) {
        picker.append(el('section', { className: 'rs-reveal', attrs: { 'aria-live': 'assertive', 'aria-labelledby': 'reveal-title' } }, [
          el('p', { className: 'rs-kicker', text: 'DRAW COMPLETE' }),
          el('h2', { id: 'reveal-title', text: state.reveal.entry.name }),
          el('p', { className: 'rs-reveal-copy', text: state.reveal.removed ? 'Selected and removed automatically from the draw.' : 'Selected and kept in the draw.' }),
          el('div', { className: 'rs-reveal-actions' }, [
            button('KEEP RESULT', 'rs-button rs-button-primary', keepResult, { 'data-focus-key': 'keep-result' }),
            button('REDRAW', 'rs-button rs-button-outline', redraw, { 'data-focus-key': 'redraw-result' }),
          ]),
        ]));
      }
      const autoRemove = el('input', { attrs: { type: 'checkbox', id: 'rs-remove-after' } });
      autoRemove.checked = state.removeAfterDraw;
      autoRemove.addEventListener('change', () => { state.removeAfterDraw = autoRemove.checked; persist(); render(); });
      picker.append(el('label', { className: 'rs-auto-remove', attrs: { for: 'rs-remove-after' } }, [autoRemove, el('span', { text: 'Remove every selected entry automatically' })]));
      app.append(picker);
      if (!state.presenting) app.append(buildControls());
      app.append(el('footer', { className: 'rs-footer' }, [el('span', { text: 'SEDUH SCORE / RANDOM SELECTOR' }), el('span', { text: 'SPLIT-FLAP EDITION' })]));
      root.replaceChildren(app);

      function buildControls() {
        const textarea = el('textarea', { className: 'rs-textarea', attrs: { id: 'rs-entries', rows: '10', spellcheck: 'false', 'data-focus-key': 'entries' } });
        textarea.value = state.draft;
        textarea.addEventListener('input', () => updateEntries(textarea.value));
        const weights = el('div', { className: 'rs-weights' }, state.entries.map((entry, index) => {
          const field = el('input', { className: 'rs-weight-input', attrs: { type: 'number', min: '1', max: '1000', step: '1', value: String(entry.weight), 'aria-label': `Weight for ${entry.name}` } });
          field.addEventListener('change', () => {
            const next = Number(field.value);
            if (!Number.isFinite(next) || next < 1) return;
            state.entries[index].weight = Math.min(1000, Math.round(next));
            state.draft = formatEntries(state.entries);
            persist();
            render();
          });
          return el('div', { className: 'rs-weight-row' }, [el('span', { text: entry.name }), field, el('span', { text: `${((entry.weight / totalWeight) * 100).toFixed(1)}%` })]);
        }));
        const importInput = el('input', { attrs: { type: 'file', accept: '.csv,text/csv', hidden: '' } });
        importInput.addEventListener('change', async () => {
          const file = importInput.files?.[0];
          if (!file) return;
          const names = csvEntries(await file.text());
          if (/^(name|names|entry|entries|participant|participants)$/i.test(names[0] ?? '')) names.shift();
          updateEntries(names.slice(0, 80).join('\n'));
          state.note = `Imported ${names.length} entries.`;
          render();
        });
        const importButton = button('IMPORT CSV', 'rs-link-button', () => importInput.click());
        const exportButton = button('EXPORT LIST', 'rs-link-button', () => download('seduh-random-selector.csv', `Entry,Weight\r\n${state.entries.map((entry) => `"${entry.name.replaceAll('"', '""')}",${entry.weight}`).join('\r\n')}`));
        const shareButton = button('COPY SHARE LINK', 'rs-link-button', () => { void copyShareLink(); });
        return el('section', { className: 'rs-controls' }, [
          el('article', { className: 'rs-entry-panel' }, [
            el('p', { className: 'rs-kicker', text: 'ENTRY LIST' }),
            el('div', { className: 'rs-panel-heading' }, [el('h2', { text: 'Names in the draw' }), el('span', { text: `${state.entries.length} loaded` })]),
            el('label', { className: 'rs-field-label', text: 'One entry per line · add | 2 for double weight', attrs: { for: 'rs-entries' } }),
            textarea,
            el('div', { className: 'rs-weight-heading' }, [el('span', { text: 'WEIGHTS & ODDS' }), el('span', { text: `${totalWeight} TOTAL WEIGHT` })]),
            weights,
            buildDrawSettings(),
            buildEventBranding(),
            el('div', { className: 'rs-entry-actions' }, [button('LOAD EXAMPLE LIST', 'rs-link-button', () => updateEntries(DEMO_ENTRIES.join('\n'))), button('CLEAR SESSION', 'rs-link-button', clearSession)]),
            el('div', { className: 'rs-entry-actions rs-transfer-actions' }, [importButton, exportButton, shareButton, importInput]),
            ...(state.note ? [el('p', { className: 'rs-note', text: state.note, attrs: { role: 'status' } })] : []),
          ]),
          el('aside', { className: 'rs-history-panel' }, [
            el('p', { className: 'rs-kicker', text: 'DRAW HISTORY' }),
            el('h2', { text: 'A clear record of every draw.' }),
            state.history.length ? el('ol', { className: 'rs-history' }, state.history.slice(-6).reverse().map((record, index) => el('li', {}, [el('span', { text: String(state.history.length - index).padStart(2, '0') }), el('strong', { text: record.name }), el('em', { text: record.removed ? 'removed' : 'kept' })]))) : el('p', { className: 'rs-history-empty', text: 'No draws yet. The result controls will keep your record accurate.' }),
          ]),
        ]);

        function buildDrawSettings() {
          const presetButtons = Object.entries(DRAW_PRESETS).map(([key, preset]) => button(
            preset.label,
            `rs-preset-button${state.drawPreset === key ? ' is-selected' : ''}`,
            () => { state.drawPreset = validDrawPreset(key); persist(); render(); },
            { 'aria-pressed': String(state.drawPreset === key) },
          ));
          const soundLevel = el('input', { className: 'rs-volume-range', attrs: { type: 'range', min: '0.1', max: '1', step: '0.1', value: String(state.soundLevel), 'aria-label': 'Split-flap sound volume', ...(state.soundOn ? {} : { disabled: '' }) } });
          soundLevel.addEventListener('input', () => { state.soundLevel = validSoundLevel(soundLevel.value); persist(); render(); });
          return el('section', { className: 'rs-draw-settings', attrs: { 'aria-labelledby': 'draw-settings-title' } }, [
            el('div', { className: 'rs-weight-heading' }, [el('span', { id: 'draw-settings-title', text: 'DRAW SETTINGS' }), el('span', { text: `${DRAW_PRESETS[state.drawPreset].duration / 1000}s SPIN` })]),
            el('div', { className: 'rs-preset-list', attrs: { 'aria-label': 'Draw duration' } }, presetButtons),
            el('label', { className: 'rs-volume-control' }, [el('span', { text: `SOUND VOLUME ${Math.round(state.soundLevel * 100)}%` }), soundLevel]),
          ]);
        }

        function buildEventBranding() {
          const title = el('input', {
            className: 'rs-brand-title-input',
            attrs: { id: 'rs-board-title', type: 'text', maxlength: '32', value: state.boardTitle, 'data-focus-key': 'board-title' },
          });
          title.addEventListener('change', () => { state.boardTitle = validBoardTitle(title.value); persist(); render(); });
          const color = el('input', {
            className: 'rs-color-input',
            attrs: { id: 'rs-accent-color', type: 'color', value: state.accentColor, 'data-focus-key': 'accent-color' },
          });
          color.addEventListener('change', () => { state.accentColor = validAccentColor(color.value); persist(); render(); });
          return el('section', { className: 'rs-event-branding', attrs: { 'aria-labelledby': 'event-branding-title' } }, [
            el('div', { className: 'rs-weight-heading' }, [el('span', { id: 'event-branding-title', text: 'EVENT BRANDING' }), el('span', { text: 'SAVED WITH SHARE LINK' })]),
            el('label', { className: 'rs-brand-title-field', text: 'BOARD TITLE', attrs: { for: 'rs-board-title' } }, [title]),
            el('label', { className: 'rs-color-field', attrs: { for: 'rs-accent-color' } }, [el('span', { text: 'ACCENT COLOUR' }), color, el('code', { text: state.accentColor.toUpperCase() })]),
          ]);
        }
      }
    });
  }

  function handleKeydown(event) {
    if (event.code === 'Space' && !['TEXTAREA', 'INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) { event.preventDefault(); startDraw(); }
  }
  window.addEventListener('keydown', handleKeydown);
  render();
  return () => { window.removeEventListener('keydown', handleKeydown); clearInterval(tickHandle); clearTimeout(finishHandle); };
}

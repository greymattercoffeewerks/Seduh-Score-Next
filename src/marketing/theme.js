// Day/night theme for the marketing landing page only — a separate concept
// from src/ui/tokens/colors.css's paper/stage surface modes (those serve the
// console's organiser/projector/phone surfaces; this serves one public page
// with no live-event constraints). Auto mode follows the visitor's local
// clock (19:00–06:59 = night); a manual choice always wins once made, and
// is remembered for next visit.
//
// Applied as `data-theme="day"|"night"` on <html>. index.html also carries a
// tiny inline, synchronous copy of `computeAutoTheme()` + the storage read,
// run before any stylesheet paints — that inline copy exists purely to
// avoid a flash of the wrong theme while this module (type="module", always
// deferred) loads; this file is the one source of truth for the logic itself
// and re-applies it once it runs, so the two can never drift into disagreeing
// permanently, only for the first paint.

const STORAGE_KEY = 'seduh-landing-theme';
const NIGHT_START_HOUR = 19; // 7pm
const NIGHT_END_HOUR = 7; // 7am

export function computeAutoTheme(date = new Date()) {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR ? 'night' : 'day';
}

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'day' || stored === 'night' ? stored : null;
  } catch {
    // Storage unavailable (private browsing, disabled cookies) — fall back
    // to auto every load rather than throwing.
    return null;
  }
}

function writeStoredTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore — a lost preference is a minor degradation, not worth surfacing.
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Re-checks the clock every 5 minutes so a page left open across the 7pm/7am
// boundary actually switches, matching the "auto" promise — but only while
// no manual override is stored; a visitor's explicit choice is never
// silently reverted by the clock.
function scheduleAutoRecheck() {
  setInterval(() => {
    if (readStoredTheme() === null) applyTheme(computeAutoTheme());
  }, 5 * 60 * 1000);
}

// Mounts the toggle's behavior onto an existing control (built by
// landingScreen.js) and returns the current effective theme so the caller
// can set the control's initial visual state (e.g. sun/moon icon).
export function initTheme(toggleButton) {
  const stored = readStoredTheme();
  const initial = stored ?? computeAutoTheme();
  applyTheme(initial);
  scheduleAutoRecheck();

  toggleButton.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'night'));
  toggleButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'night' ? 'day' : 'night';
    applyTheme(next);
    writeStoredTheme(next);
    toggleButton.setAttribute('aria-pressed', String(next === 'night'));
  });

  return initial;
}

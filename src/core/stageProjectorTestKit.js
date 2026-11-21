// A test helper every format's projector can run (see "Adding a projector to a format" in src/core/CLAUDE.md). It
// pins the contracts a venue display must keep whatever it shows, so a new format gets them for one call:
//
//   describeProjectorContract('Throwdown projector', {
//     selectScreen, hasContent,            // the format's own two functions (core/stageDisplay.js)
//     samples: { 'setup': payload, ... },  // ordinary payloads, one per phase
//     worstCases: [{ label, payload, mustShow: ['the longest name'] }],  // fullest page, longest names
//   });
//
// What it checks: (1) `hasContent` and `selectScreen` agree on every sample (a payload the shell calls content
// but no screen shows would leave a blank display), and nothing is selected for null; (2) every screen mounts,
// draws some text, survives a second identical snapshot WITHOUT changing the DOM (a republish must never restart
// or redraw anything), and destroys cleanly; (3) each worst case mounts, shows every `mustShow` string and keeps
// going through its whole page loop without throwing. jsdom has no layout, so "fits" is the format's own
// Playwright/visual check at 1920x1080 and 360 px; this guards the logic and the text.
import { describe, it, expect, vi, afterEach } from 'vitest';

function mountScreen(screen, payload) {
  const host = document.createElement('div');
  document.body.append(host);
  return { host, handle: screen.mount(host, payload) };
}

// Every page of a loop screen: advances the clock past each dwell and collects the text on show each time.
function collectLoopText(host, steps, stepMs) {
  const seen = [host.textContent];
  for (let i = 0; i < steps; i += 1) {
    vi.advanceTimersByTime(stepMs);
    seen.push(host.textContent);
  }
  return seen.join('\n');
}

export function describeProjectorContract(
  name,
  { selectScreen, hasContent, samples, worstCases = [], loopStepMs = 10_000, loopSteps = 12 },
) {
  describe(`${name}: projector contract`, () => {
    afterEach(() => {
      vi.useRealTimers();
      document.body.replaceChildren();
    });

    it('selects nothing for no payload', () => {
      expect(selectScreen(null)).toBeNull();
    });

    for (const [label, payload] of Object.entries(samples)) {
      it(`hasContent and selectScreen agree: ${label}`, () => {
        expect(hasContent(payload)).toBe(selectScreen(payload) !== null);
      });

      it(`draws something and ignores an identical republish: ${label}`, () => {
        const screen = selectScreen(payload);
        if (!screen) return;
        vi.useFakeTimers();
        const { host, handle } = mountScreen(screen, payload);
        expect(host.textContent.trim().length).toBeGreaterThan(0);
        const before = host.innerHTML;
        handle.update?.(structuredClone(payload));
        expect(host.innerHTML).toBe(before);
        expect(() => handle.destroy()).not.toThrow();
      });
    }

    for (const { label, payload, mustShow = [] } of worstCases) {
      it(`worst case renders, every page: ${label}`, () => {
        const screen = selectScreen(payload);
        expect(screen).not.toBeNull();
        vi.useFakeTimers();
        const { host, handle } = mountScreen(screen, payload);
        const text = collectLoopText(host, loopSteps, loopStepMs);
        for (const wanted of mustShow) expect(text).toContain(wanted);
        handle.destroy();
      });
    }
  });
}

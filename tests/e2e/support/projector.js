// Watches a Throwdown venue display (the projector) for as long as it takes to see every wanted piece of text.
// The display is not a static screen: it rotates its pages every 10 seconds and plays an 8 second moment for each
// confirmed result, so one look at it shows one page. This polls the screen's words (the main area and the footer's
// start side; the ring's countdown is not content) in the page itself, so no screen is missed between two checks,
// and returns every distinct screen it saw, so a caller can run a negative assertion on ALL of them.
export async function watchProjector(page, { needs = [], maxMs = 90000 } = {}) {
  return page.evaluate(
    async ({ wanted, limit }) => {
      const read = () =>
        [...document.querySelectorAll('.stage-main, .stage-footer-start')]
          .map((node) => node.textContent)
          .join(' | ');
      const screens = new Set();
      const started = Date.now();
      while (Date.now() - started < limit) {
        screens.add(read());
        const all = [...screens].join('\n');
        if (wanted.every((text) => all.includes(text)))
          return { screens: [...screens], done: true };
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return { screens: [...screens], done: false };
    },
    { wanted: needs, limit: maxMs },
  );
}

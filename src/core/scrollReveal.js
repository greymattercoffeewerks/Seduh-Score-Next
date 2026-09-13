// Reveals an element the first time it scrolls into view — adds a class,
// disconnects, never reverts. Format-agnostic (nothing here assumes
// marketing/landing-page specifics, even though its first consumer is
// src/marketing's Petrol rework) — any future screen wanting a "fade up on
// scroll" section reuses this instead of hand-rolling a second
// IntersectionObserver.
//
// Reduced motion: the element is revealed immediately, with no observer at
// all, rather than an instant class-add that still fights a CSS transition —
// the caller's own CSS is expected to gate the actual transition/transform
// under `@media (prefers-reduced-motion: no-preference)`, same discipline as
// every other animation in this codebase.
//
// Returns a disconnect function — the same cleanup-lifecycle contract
// viewer-shell.js's `renderBody` return value already documents. Its only
// consumer today (src/marketing/landingScreen.js) discards it, which is
// harmless there since that page mounts once and never unmounts — but a
// future ROUTER-MOUNTED screen (anything reached through core/router.js,
// unlike this permanently-mounted marketing page) must capture and call it
// on unmount, or a repeated navigation leaks one IntersectionObserver per
// mount.
export function revealOnScroll(el, { className = 'is-revealed', threshold = 0.12 } = {}) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add(className);
    return () => {};
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          el.classList.add(className);
          observer.disconnect();
        }
      }
    },
    { threshold },
  );
  observer.observe(el);
  return () => observer.disconnect();
}

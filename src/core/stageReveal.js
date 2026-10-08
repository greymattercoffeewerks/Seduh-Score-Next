// Makes the items of a list rise in one after another (core/stageMoments.css), once. A venue display's body
// is detached and re-attached whenever a live payload arrives (core/stageBody.js), and moving a node restarts
// any CSS animation still applied to it, so the animation is switched off the moment the last item finishes:
// a re-attach after that finds the items already in place and nothing replays under a room that is reading.
// Items opt in with the `stage-reveal-item` class; under prefers-reduced-motion the stylesheet applies no
// animation at all, so there is nothing to wait for.
export function revealOnMount(list) {
  const items = list.querySelectorAll('.stage-reveal-item');
  const last = items[items.length - 1];
  if (!last) return list;
  list.classList.add('stage-reveal');
  last.addEventListener('animationend', (event) => {
    if (event.target === last) list.classList.remove('stage-reveal');
  });
  return list;
}

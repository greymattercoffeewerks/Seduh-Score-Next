// Plays "moments" on a venue display: short screens that tell the room what JUST happened (a result was
// recorded, the table moved) in between the display's ordinary screens. Format-agnostic.
//
// A venue display is sent snapshots of the live state, never events. A moment is therefore found by comparing
// each snapshot with the one before it, which the caller does in `detectMoments(previous, next)` and which
// returns the moments to play, in order:
//
//   [{ screen, payload }]     `screen` is an ordinary screen (core/screenDirector.js) whose `minDwellMs` is how
//                             long the moment stays; `payload` is what it is mounted with.
//
// The player owns the order and the clock: moments queue and play one after another, then the display goes back
// to whatever `selectScreen` wants for the latest snapshot. Rules:
//   - the first snapshot only sets the baseline: a display opened (or reloaded) mid-event has no earlier
//     snapshot, so there is nothing to say happened;
//   - a moment is shown at once, pre-empting a screen that is being held (it is the news), and each play gets
//     its own screen key so the director mounts it fresh;
//   - a screen that wants to be `urgent` (a running countdown) always wins: the queue is dropped and it is
//     shown, because a room watching a clock cannot wait for a replay. A snapshot that already shows such a
//     screen is not searched for moments either (it still becomes the baseline), so news that arrives in the
//     same snapshot as the next countdown is not announced;
//   - if moments pile up (several results arrive while one plays) only the newest `maxQueued` wait; the oldest
//     queued are dropped so the display never runs far behind the room;
//   - a moment that cannot be drawn, or a detector that throws on a snapshot, costs that moment only: it is
//     skipped (and logged) and the display carries on, never left blank;
//   - destroy() ends everything: no timer survives it.
export function createMomentPlayer({
  director,
  selectScreen,
  detectMoments,
  maxQueued = 4,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let latest = null;
  let queue = [];
  let playing = false;
  let timer = null;
  let plays = 0;
  let destroyed = false;

  function stopPlaying() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    playing = false;
  }

  function advance() {
    while (!destroyed && !playing) {
      const moment = queue.shift();
      if (!moment) {
        director.show(selectScreen(latest), latest);
        return;
      }
      plays += 1;
      playing = true;
      try {
        director.show(
          { ...moment.screen, key: `${moment.screen.key}#${plays}`, urgent: true },
          moment.payload,
        );
      } catch (error) {
        playing = false;
        console.error('momentPlayer: a moment could not be shown and was skipped', error);
        continue;
      }
      timer = setTimer(() => {
        timer = null;
        playing = false;
        advance();
      }, moment.screen.minDwellMs ?? 0);
    }
  }

  function detect(before, payload) {
    try {
      return detectMoments(before, payload) ?? [];
    } catch (error) {
      console.error('momentPlayer: moments could not be worked out for a snapshot', error);
      return [];
    }
  }

  return {
    update(payload) {
      if (destroyed) return;
      const before = latest;
      latest = payload;
      const wanted = selectScreen(payload);
      if (wanted?.urgent) {
        queue = [];
        stopPlaying();
        director.show(wanted, payload);
        return;
      }
      if (before) {
        queue.push(...detect(before, payload));
        if (queue.length > maxQueued) queue = queue.slice(queue.length - maxQueued);
      }
      // A moment on screen runs its course (the newest snapshot is shown after it); otherwise carry on.
      advance();
    },
    destroy() {
      destroyed = true;
      queue = [];
      stopPlaying();
    },
  };
}

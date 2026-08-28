// Viewer shell, format-agnostic (handoff §6, §14 T5.2): "Identity band,
// badges, holding states, reconnect. Mounts a format body." Both live
// surfaces (T5.3 projector, T5.4 phone) are thin entry points around this —
// same container, same subscription/holding-state machinery, different
// outer chrome (`showChrome`) and `data-surface` token mode set by the
// caller on its own root, not by this module.
//
// Watches `live_sessions` by ORG, not event (D19: history is retained per
// event, but a viewer link is handed out once per org — "tonight's
// competition" — and should keep showing whatever event is currently
// active, the same way the legacy app's org-keyed live document did, even
// though the data underneath no longer overwrites in place). Concretely:
// `select * from live_sessions where org_id = :orgId and active = true` —
// at most one row, per the table's own partial unique index.
//
// Realtime is a "something changed, re-fetch" signal, not a payload-diff
// source: every postgres_changes event on this org's rows (any event type,
// any row) triggers a plain re-read of the currently-active session, rather
// than trying to reconstruct state from the delta stream. `publish_session`
// changes are rare and human-triggered (§9: single-writer per event), so
// the extra round trip costs nothing observable and sidesteps a real
// raciness a payload-driven approach would have to solve instead: two
// UPDATEs from one publish_session call (deactivate old, activate new) can
// arrive as separate messages, in either order, and only a re-read is
// guaranteed to reflect the post-transaction truth regardless of that
// order. The channel is subscribed BEFORE the initial read (found in
// review: subscribing only after awaiting that first read leaves a real
// gap — a full request/response round trip — during which a change could
// land and never be observed until some later, unrelated event happens to
// arrive). Refresh calls themselves carry a monotonic sequence number so a
// slower-resolving earlier call can never clobber a faster-resolving later
// one — the same class of out-of-order-response problem the realtime
// change stream itself already has to tolerate.
//
// "Holding states" (§8.4) belong to THIS module, not the format body — the
// body is only ever mounted once real content exists. But whether a given
// payload actually COUNTS as content is inherently format-specific (Cup
// Taster's shape isn't core's business), so that one decision is the
// caller's own injected predicate (`hasContent`), the same
// inversion-of-control shape `core/outbox.js` already uses for its handler
// map — this module owns the state machine and every holding card; the
// caller owns only the yes/no question of whether its own payload is ready.
//
// The DOM is built ONCE at mount and mutated in place on every render, not
// torn down and rebuilt via innerHTML — found in review: a screen reader
// needs a MUTATING node to detect an aria-live region's change; a freshly
// re-inserted node (even one that already carries role="status") is not
// reliably announced by every AT. Every other screen in this codebase uses
// full-subtree rebuild-then-refocus safely because a user ACTION anchors
// the focus move that announces the outcome; this is a passive,
// no-interaction "watch and wait" surface with no action to hang that on,
// so the live region itself has to be the whole mechanism.
//
// `renderBody` may optionally return a cleanup function (T5.3/T5.4's own
// viewerBody.js does, for its live countdown's setInterval) — this module
// calls it before every subsequent `body.replaceChildren()` and again on
// `unmount()`. `body` is rebuilt on every re-render (any postgres_changes
// event for this org, not just ones affecting the active heat), so without
// this a ticking body would leak one orphaned interval per unrelated
// refresh, each still mutating its own now-detached DOM node forever.
import { getSupabase } from './supabaseClient.js';
import { el } from './dom.js';
import { findLatestEventForOrg } from './events.js';

export function defaultHasContent(payload) {
  return payload != null && typeof payload === 'object' && Object.keys(payload).length > 0;
}

function holdingCard(icon, title, body) {
  return el('div', { className: 'viewer-holding-card' }, [
    el('div', { className: 'viewer-holding-icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
    el('div', { className: 'viewer-holding-title', text: title }),
    el('div', { className: 'viewer-holding-body', text: body }),
  ]);
}

// Exported for direct testing — the exact card each phase/connection-lost
// state renders, independent of the subscription machinery around it.
// `noEvent`/`notStarted` are the handoff's own two separately-named states
// (§8.4: "no event, not started, started-but-nothing-published, connection
// lost") — found in review (T5.3, closed as its own follow-up task): both
// used to collapse into one generic card under a single `'empty'` phase,
// since this module never read `events`, only `live_sessions`. `pending`
// below is already the correct "started-but-nothing-published" state (an
// active live_sessions row exists, just with no real content yet) — it was
// never actually ambiguous; only the "nothing published AND no active
// session at all" case was.
export function renderHoldingState(phase) {
  switch (phase) {
    case 'connecting':
      return holdingCard('🕐', 'Connecting…', 'Waiting for the live session.');
    case 'noEvent':
      return holdingCard(
        '📅',
        'No event scheduled',
        'There’s nothing set up here yet. Check back once an event has been created.',
      );
    case 'notStarted':
      return holdingCard(
        '📭',
        'Waiting for the organiser',
        'This event will appear here as soon as it goes live.',
      );
    case 'pending':
      return holdingCard(
        '⏳',
        'Event not published yet',
        'The organiser has started the display but hasn’t published anything yet.',
      );
    case 'lost':
      return holdingCard(
        '📡',
        'Connection lost',
        'Trying to reconnect. This will reappear automatically.',
      );
    default:
      throw new Error(`renderHoldingState: unknown phase "${phase}"`);
  }
}

// Exported for direct testing. `session` is the current live_sessions row
// (or null); `connectionLost` overrides the badge to a neutral reconnecting
// state rather than showing a stale "Live" that no longer reflects whether
// THIS viewer can actually see current data (found in review: the event
// itself may still be live even though this viewer's own connection
// dropped — showing "Live" next to a "Connection lost" body read as
// contradictory). The identity name is deliberately always the generic
// app name, never `session.format` (e.g. "cup_taster") — live_sessions has
// no denormalized human-readable event name to show instead (only
// `events.name` does, which this module never reads), so showing the raw
// format slug as if it were a title would be a permanent-looking
// placeholder masquerading as finished UI (found in review).
export function renderChrome(session, connectionLost = false) {
  let statusBadge;
  if (connectionLost) {
    statusBadge = el('span', {
      className: 'viewer-badge viewer-badge-lost',
      text: 'Reconnecting…',
    });
  } else if (session?.active) {
    statusBadge = el('span', { className: 'viewer-badge viewer-badge-live' }, [
      el('span', { className: 'status-live-dot', attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: 'Live' }),
    ]);
  } else {
    statusBadge = el('span', { className: 'viewer-badge viewer-badge-done', text: 'Not live' });
  }

  return el('div', { className: 'viewer-chrome' }, [
    el('span', { className: 'viewer-chrome-name', text: 'Seduh Score' }),
    statusBadge,
  ]);
}

// A hung request must not leave the viewer on "Connecting…" forever (§8.4:
// "never leave a user watching a spinner" — an unbounded wait is the same
// failure mode under a different name). Resolves to the same shape a real
// query error would, so callers don't need a separate branch for "timed
// out" vs. "failed."
const REFRESH_TIMEOUT_MS = 10000;
// The events-existence check (below) is a secondary, non-critical read —
// its own comment already frames it as "purely the cosmetic distinction
// while genuinely nothing has happened yet." It runs strictly AFTER the
// primary live_sessions read succeeds, not concurrently with it, so giving
// it the full REFRESH_TIMEOUT_MS would silently double the module's own
// documented no-spinner-forever bound on a slow-but-not-erroring network —
// found in review (T5.3's holding-state follow-up).
const EVENT_CHECK_TIMEOUT_MS = 4000;
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ data: null, error: new Error('timed out') }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Same guard, different shape — `findLatestEventForOrg` throws on error and
// resolves with the row directly (events.js's own convention), not the
// `{data,error}` envelope `withTimeout` above is built around. Racing it
// against a REJECTING timeout instead of a resolving one keeps both error
// paths (a real throw, and a timeout) landing in the same catch block at
// the call site, without `withTimeout`'s sentinel object being mistaken for
// a real (truthy) result if it ever won the race.
function raceTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function mountViewerShell(
  root,
  { orgId, renderBody, hasContent = defaultHasContent, showChrome, client = getSupabase() } = {},
) {
  if (typeof showChrome !== 'boolean') {
    throw new TypeError('mountViewerShell: showChrome must be explicitly true or false');
  }

  let session = null;
  let phase = 'connecting';
  let connectionLost = false;
  let mounted = false;
  let requestSeq = 0;
  let lastIsTest = null;
  let bodyCleanup = null;
  // Whether this org has ANY event row yet — distinguishes 'noEvent' from
  // 'notStarted' below. Starts false and is only ever re-checked while still
  // false (an event, once created, doesn't get un-created) — so a transient
  // read failure just means "try again next refresh" rather than
  // permanently caching a false negative.
  let hasEvent = false;

  root.innerHTML = '';
  const container = el('div', { className: 'viewer-shell' });
  const chromeHost = el('div', {});
  const bannerHost = el('div', {});
  // role="status"/aria-live="polite" lives on THIS node permanently — every
  // render mutates its children in place, never replaces the node itself.
  const body = el('div', {
    className: 'viewer-shell-body',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  container.append(chromeHost, bannerHost, body);
  root.appendChild(container);

  function render() {
    chromeHost.replaceChildren(...(showChrome ? [renderChrome(session, connectionLost)] : []));

    // role="alert" (implies aria-live="assertive") rather than the body's
    // own polite region — found in review: is_test flipping on/off mid-view
    // (a real possibility, since this shell re-fetches on every change
    // event) needs to interrupt, not wait politely, per D9's "unmistakable"
    // bar. Unlike aria-live="polite", role="alert" is designed to announce
    // on insertion, so recreating this element each render (rather than
    // mutating a persistent one, like `body` below) is correct here, not a
    // gap — but only when the VALUE actually changed. Without the
    // lastIsTest guard, every unrelated refresh (a standings update, a
    // publish with the same is_test) would recreate this node and
    // re-announce it, which is verbose/disorienting for a screen-reader
    // user watching a long is_test event (found in round-2 review) — over-
    // announcing, not the under-announcing D9 actually cares about, but
    // still worth closing.
    const isTest = session?.is_test === true;
    if (isTest !== lastIsTest) {
      bannerHost.replaceChildren(
        ...(isTest
          ? [
              el('div', {
                className: 'is-test-banner',
                text: 'Test Data — Not a Live Event',
                attrs: { role: 'alert' },
              }),
            ]
          : []),
      );
      lastIsTest = isTest;
    }

    bodyCleanup?.();
    bodyCleanup = null;
    body.replaceChildren();
    if (connectionLost) {
      body.appendChild(renderHoldingState('lost'));
    } else if (phase === 'live') {
      // The real Cup Taster viewer-body (T5.4) treats a manual-mode heat
      // with no started_at as ITS OWN defined no-clock state (§8.2: cupper
      // names/station/finished-not-finished, never a blank or zeroed
      // timer) — that heat's own payload still counts as "content" via
      // hasContent, so it reaches here, not the generic "not published
      // yet" card above.
      // Not `?? null`: `bodyCleanup?.()` below already tolerates `undefined`
      // exactly like `null` (found in review — the normalization was
      // provably redundant, no test could distinguish the two).
      bodyCleanup = renderBody(body, session.payload, { isTest: session.is_test === true });
    } else {
      body.appendChild(renderHoldingState(phase));
    }
  }

  function computePhase() {
    if (!session) return hasEvent ? 'notStarted' : 'noEvent';
    return hasContent(session.payload) ? 'live' : 'pending';
  }

  async function refresh() {
    const seq = ++requestSeq;
    const { data, error } = await withTimeout(
      client.from('live_sessions').select('*').eq('org_id', orgId).eq('active', true).maybeSingle(),
      REFRESH_TIMEOUT_MS,
    );
    if (!mounted) return;
    // A slower-resolving earlier call must never clobber a faster-resolving
    // later one — real requests can complete out of order.
    if (seq !== requestSeq) return;
    if (error) {
      // Nothing actionable for a read-only viewer (no retry button, no
      // user-facing detail to add) — same "connection lost" state a
      // channel drop shows, but still worth a diagnostic for whoever's
      // debugging a viewer stuck here in production.
      console.error('viewer-shell: failed to read live_sessions', error);
      connectionLost = true;
      render();
      return;
    }
    session = data;
    if (session) {
      hasEvent = true; // an active live_sessions row implies its event exists
    } else if (!hasEvent) {
      // Only worth the extra read while we don't already know the answer —
      // there's no realtime subscription on `events`, so this can't react
      // to an event being created while the viewer already sits idle on
      // 'noEvent', but the next live_sessions activity (the organiser's
      // first real publish) reaches 'live'/'pending' regardless; this is
      // purely the cosmetic distinction while genuinely nothing has
      // happened yet.
      let foundEvent = false;
      try {
        foundEvent = Boolean(
          await raceTimeout(findLatestEventForOrg(orgId, client), EVENT_CHECK_TIMEOUT_MS),
        );
      } catch (err) {
        console.error('viewer-shell: failed to check for an existing event', err);
      }
      // Written only AFTER the staleness guard, matching the primary
      // session read's own ordering just above — found in review: writing
      // `hasEvent` directly inside the try/catch, before this check, meant
      // a slower-resolving earlier call could still overwrite the shared
      // flag even after a faster-resolving later call had already moved
      // on. Harmless today (an event, once found, never un-exists), but
      // the file's own "a slower call must never clobber a faster one"
      // invariant (see the comment above) should hold uniformly, not just
      // for `session`, in case that assumption ever stops being true.
      if (!mounted || seq !== requestSeq) return;
      hasEvent = foundEvent;
    }
    phase = computePhase();
    // A successful read recovers from connectionLost on its own — found in
    // review: without this, a lost state entered via a QUERY error/timeout
    // (as opposed to a channel-level drop) would only ever clear via the
    // channel's own SUBSCRIBED handler below, which never fires again if
    // the channel itself never blipped. Every later postgres_changes event
    // would keep this refresh() succeeding and updating `session` in
    // memory while render() kept showing "Connection lost" regardless —
    // the exact unbounded-stuck-state failure mode the timeout above
    // exists to prevent, just reached a different way.
    connectionLost = false;
    render();
  }

  render(); // paints 'connecting'
  mounted = true;

  const channel = client
    .channel(`live_sessions:${orgId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'live_sessions', filter: `org_id=eq.${orgId}` },
      () => {
        refresh();
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // The very first connect is already covered by the explicit
        // `await refresh()` below — only a genuine reconnect (recovering
        // from a prior drop) needs its own refresh here. Only READS
        // connectionLost to decide whether to act, doesn't set it — that
        // flag has exactly one owner now, refresh()'s own success/error
        // branches, so it can't go stale here if refresh() takes a while.
        if (connectionLost) {
          refresh();
        }
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        connectionLost = true;
        render();
      }
    });

  await refresh();

  return {
    unmount() {
      mounted = false;
      bodyCleanup?.();
      bodyCleanup = null;
      root.innerHTML = '';
      client.removeChannel(channel);
    },
  };
}

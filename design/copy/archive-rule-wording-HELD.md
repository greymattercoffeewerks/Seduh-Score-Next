# Archive rule: Privacy and Terms wording (HELD, owner-approved 2026-10-17)

**Status: approved, NOT applied.** Do not copy any of this into `src/marketing/trustContent.js`,
`privacy-page-draft.md` or `terms-page-draft.md` until the compulsory publishing is built and live.
The Privacy page states what the code really does, and today publishing is optional on every plan.
This file exists so the approved wording is not lost.

**Apply it in the same PR that ships the enforcement** (the archive phase; see
`Handoffs and Specs/GATING-SPEC.md` section 6b, which is local only). In that PR also:

- update the date at the top of the Privacy page;
- edit `trustContent.js` and both draft files together (the drafts are the owner-edited source);
- run `trustScreen.test.js`, which fails if a review marker reaches a page.

**The rule (owner decisions, 2026-10-17):**

- On the Community plan, every event's results are published to the public archive **automatically when
  the event ends**.
- What is published is **the podium** (the top three), the same default as any event today. Not the full
  standings.
- On Per-event and Annual, the organiser chooses whether to publish and how much.
- No extra removal route for Community competitors: the existing "Asking us to remove or correct your
  data" process stands.
- **Precondition:** the database has no "event ended" fact today (`events.status` exists but nothing writes
  it). Define it first, make the publish fail open, and warn the organiser before it publishes.

## Privacy: "Who can see it", the public bullet

**Replace** "...and whatever an organiser chooses to publish as event results. For a Cup Taster event the
organiser chooses how much. ..." **with:**

> ...and the results of events published to the public results archive. Whether an event is published
> depends on the organiser's plan. On the free Community plan, an event's results are published to the
> archive automatically when the event ends, showing the podium (the top three). On the paid plans, the
> organiser chooses whether to publish and how much. ...

The rest of that bullet (what a podium or full standings shows, what is never published) stays as it is.

**Add this bullet** under "Who can see it":

> **If you take part in an event** run on the Community plan, your placing, name and cafe appear in the
> public archive when the event ends. On the paid plans, the organiser decides.

## Terms

**"The organiser is in charge of the event"**, add a bullet:

> If your event runs on the Community plan, its results (the podium) are published to the public archive
> automatically when the event ends. Tell your competitors before the event that their name, cafe and
> placing will be public.

**"Pricing"**, replace the paragraph with:

> Pricing is set out on the [Pricing page](/pricing/) and is not part of these terms, except for one
> condition: on the Community plan, the organiser agrees that the event's results (the podium) are
> published to the public archive automatically when the event ends.

## Separate, later

The event registration page (Per-event and Annual) collects personal data from competitors directly. It
needs its own Privacy update when it is built: what it collects, who sees it, how it feeds the roster.
Not drafted.

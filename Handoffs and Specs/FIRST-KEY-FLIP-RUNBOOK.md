# First gating key flip: `cup_taster_participants` (D-G27), by hand

**Status: runbook, not an instruction to flip.** Written 2026-10-28 by Claude Code. Nothing was flipped, nothing was written to
the cloud. Flips are done by the owner, in the admin console, never from code; the auto-mode check also blocks Claude from
clicking them (state.json scope decision).

**Who does what.** Every step is marked **[OWNER]** or **[CLAUDE]**. A step marked [CLAUDE] is read-only or local.

---

## 1. Preconditions (re-verified 2026-10-28)

Cloud facts below come from **read-only** `execute_sql` / `list_migrations` on project `wxzwanprluqmgoagbkpv`, aggregate counts
only, nothing written. Re-run them on the day.

| # | Precondition | State on 2026-10-28 | How verified |
|---|---|---|---|
| 1 | All 11 keys are off in the cloud | **True.** `audience_branding, btc_format, cup_taster_analytics, cup_taster_participants, cup_taster_report, event_window_lock, events_open, guess_the_bean_create, registration_page, results_archive_optional, season_history` all `enforced = false` | `select key, enforced from app.entitlement_keys order by key;` |
| 2 | Cloud migrations equal the repo's | **True by name.** Cloud ends at `20261027012320 window_lock_set_based`; `origin/dev` ends at `20261027100000_window_lock_set_based.sql`. The version number differs (cloud stamped at push time), the name and body match per ROADMAP | `list_migrations` against `ls supabase/migrations` |
| 3 | The backfill: every existing organisation holds a top-tier grant | **True.** 1 organisation (Grey Matter Coffee Werks), 1 live grant, shape `annual/org` | `select count(*) from public.orgs;` and `select tier, event_id is null from public.entitlement_grants where revoked_at is null;` (aggregate) |
| 4 | No event is live now | **True.** 0 live sessions | `select count(*) from public.live_sessions where active;` |
| 5 | The 2026-10-04 event is the one over the Community cap | **Consistent.** Exactly 1 event has more than 8 active entries (Claude did not open it or read names; you told us it has 17) | `select count(*) from (select event_id from public.event_entries where not withdrawn group by event_id having count(*) > 8) x;` |
| 6 | The preview says nobody loses anything | See section 2 | |
| 7 | The code that explains a refusal exists | **True.** `src/core/errors.js` `GATING_MESSAGES.cup_taster_participants` (G-C2). Roster, setup, scoring and the other Cup Taster screens route errors through `describeError` | read |
| 8 | Local rehearsal green | **[CLAUDE]** `supabase/tests/054_entitlement_enforcement_hooks.sql` covers: ninth entry refused (42501, hint `entitlement_cap_reached`, detail `cup_taster_participants`), reinstating a withdrawn entry at the cap refused, withdrawn entries not counted. Run `npm run db:reset` and `supabase test db --local supabase/tests` the day before | CI and local |
| 9 | You can sign in at `/admin/` with a fresh authenticator code | **[OWNER]** The functions need an aal2 session with TOTP verified in the last 60 minutes | try signing in first |
| 10 | Not during an event | **[OWNER]** Do not flip on an event day. The roster is the thing the key polices | calendar |

Also true and worth knowing (migration `20261023120000` header): while all keys are off the go-live snapshot stamp writes
nothing. An event that goes live **after** the first key is on gets a snapshot (tier frozen at first publish, D-G4) which is not
removed if the key is turned off again. Events that went live before the flip have no snapshot and are resolved live from the
grants; with an Annual grant that is the same answer.

## 2. The preview (the gate)

**[OWNER], in the console.** Sign in at `/admin/` → **Plans and keys** → find "Participants per Cup Taster event" → press
**Preview turning it on**. The panel calls `admin_gating_preview('cup_taster_participants')`, which lists organisations that would lose
something, with name, tier and detail.

**Expected result today:** "If you turned this on now, nobody would lose anything." (count 0, empty list). Reason: Grey Matter
holds an Annual grant (cap unlimited on Annual), and it is the only organisation.

**Counterfactual (why the preview matters):** the 2026-10-04 event has 17 active entries against the Community cap of 8. Were
Grey Matter on Community, the preview would list it (the key's `would_lose` rule counts organisations with any Cup Taster event
over its cap). Existing entries are never removed by the flip (D-G4/D-G6); the cap only refuses the **next** add or reinstate.

**SQL equivalent, [CLAUDE] or [OWNER], read-only, as the database owner (the Supabase MCP `execute_sql` or SQL editor):**

```sql
select * from app.gating_would_lose('cup_taster_participants');
```

Expected: zero rows. (`public.admin_gating_preview` itself needs an admin JWT with aal2, so it cannot be called from the SQL
editor; `app.gating_would_lose` is the function it wraps.) A second check, counts only:

```sql
select o.name, count(*) filter (where not x.withdrawn) as active_entries
from public.events e
join public.orgs o on o.id = e.org_id
left join public.event_entries x on x.event_id = e.id
where e.format = 'cup_taster'
group by o.name, e.id
order by 2 desc limit 5;
```

## 3. The flip

**[OWNER]** only. In the same panel, after the preview: **Turn on** → read the question ("Turn on 'Participants per Cup Taster event'
now? ... Nobody loses anything today.") → confirm. The panel sends `admin_set_key_enforced('cup_taster_participants', true, 0)`;
`p_confirm` must equal the previewed count, so a count that moved since the preview is refused (`confirm_mismatch`). The
database writes an audit row `gating.key_enforced`.

Do not use SQL to flip: the SQL route skips the audit row and the confirm check.

## 4. What to watch after the flip

For the first hour, then the next time an organiser runs a roster:

- **[OWNER]** Admin console → **Audit log**: one `gating.key_enforced` row, key `cup_taster_participants`, `would_lose` 0.
- **[OWNER]** Keys screen shows the key "On: in force".
- **[CLAUDE]** (read-only, on request) `select key, enforced from app.entitlement_keys where enforced;` shows exactly one row.
- **[OWNER]** Grey Matter's own roster still adds a ninth and beyond participant (Annual: no cap). This is the real-world check that
  the grant is read correctly: if Grey Matter is refused the cap, **turn the key off at once** (section 5).
- **[CLAUDE]** Supabase logs (`get_logs` type postgres/api) for `entitlement_cap_reached` or 42501 on `event_entries`; none expected.
- Anyone reporting "This event has reached its entry limit": that is a Community organiser meeting the cap, working as designed, but there
  are none today, so any report is a surprise worth checking.

## 5. Rolling back

**[OWNER]**: Keys screen → the key → **Turn off** → confirm ("Everyone keeps today's behaviour again at once."). This calls
`admin_set_key_enforced('cup_taster_participants', false, null)`, writes `gating.key_relaxed`, and is immediate, one call, no data
change. The flip is reversible: the key only changes whether the `event_entries` cap trigger refuses; no entry was ever removed or
altered. Turning off when it is already off is a no-op with no audit row. Snapshots stamped while the key was on remain (set once);
with every key off they change nothing.

**What a refusal looks like to an organiser (G-C2).** A Community organiser adding a ninth participant (or reinstating a withdrawn
one at the cap) gets the database refusal 42501, hint `entitlement_cap_reached`, detail `cup_taster_participants`, and the roster
screen shows, via `describeError`:

> This event has reached its entry limit. Nothing already saved has been lost. Contact the Seduh Score team on +673 835 1231 or greymatter.cw@outlook.com

A refused write of any other kind keeps the generic "Something went wrong saving that — try again."
**Not traced by Claude:** whether a roster add queued offline and replayed later surfaces the same copy (the roster add is believed
to be an online insert); check on the iPad if it matters.

## 6. Smoke test after the flip

Grey Matter cannot show the refusal (Annual). Two levels:

1. **[CLAUDE], local, any time before:** `npm run db:reset`, enforce the key through the audited switch (the Playwright helper
   `tests/e2e/support/grants.js` `setKeyEnforced`), add 9 roster entries as a Community organisation and check the ninth is refused
   with the hint, then relax. pgTAP `054` already proves this at database level.
2. **[OWNER], cloud, optional, needs care:** to *see* the copy in production, provision a throwaway Community organisation from `/admin/`
   (New organisation), add 8 entries, try a ninth, read the message, then remove the throwaway by SQL (the console cannot disable or
   delete; the audit rows stay). This creates a login and an organisation on the live project, so do it only if you want the proof.
   Skipping it is reasonable: the first flip's value is the preview and Grey Matter's own check in section 4.

## 7. The rest of the keys, in order (D-G27, D-G2)

The agreed order is: **cup_taster_participants**, then `btc_format`, then the report, analytics and branding keys, the Per-event
window lock last. `events_open` goes with the participant cap (D-G27). One key at a time; each: preview, flip, watch, relax if wrong.

| Order | Key (panel name) | Needs before the flip | Who |
|---|---|---|---|
| 1 | `cup_taster_participants` | This runbook | OWNER |
| 1b | `events_open` (One open event at a time), goes with the cap per D-G27 | Preview lists organisations with an unfinished event (today 0 open events in the cloud); release or finish stuck events first (`admin_event_release`, with a reason); the organiser Finish button exists (#332/#333) | OWNER, CLAUDE for read-only checks |
| 2 | `btc_format` | The e2e fixture from this branch (CI would otherwise break: `createTenant` now grants Annual through `admin_grant_create`); **no BTC event live** at the time (a live BTC event without a snapshot has its next publish refused, B4 item 2); preview first. The cloud has 1 BTC event, none live | CLAUDE (fixture, done in the code PR), OWNER (flip) |
| 3 | `cup_taster_report` | Per-event and Annual keep it; check no Community organisation relies on the printable report/CSV today. Preview | OWNER |
| 4 | `cup_taster_analytics` | Annual only: preview must be reviewed for Per-event customers | OWNER |
| 5 | `audience_branding`, `results_archive_optional`, `season_history` | Reserved/planned keys: the feature and the hook behind each may not exist yet; confirm the hook exists before flipping, otherwise the flip does nothing | CLAUDE (check), OWNER |
| 6 | `registration_page` | Seduh ID layer 2 (its own spec); not window-bound | later |
| n/a | `guess_the_bean_create` | Registered, open to every tier (D-G5); do not flip | none |
| last | `event_window_lock` | The announcement (see `WINDOW-LOCK-ANNOUNCEMENT-DRAFT.md`) and its owner questions; B5 items 1 to 5 (cost measurement on real ended grants, 360px notice overlap, Honor phone check, realtime last-frame, anonymous fall-through); preview lists organisations with a locked event now; ideally G-F1 CSV email and D-G22 | OWNER, CLAUDE |

Every key: **preview, then flip, then watch, then relax if wrong**; never two keys at once.

## 8. Open items found while writing this

- ROADMAP B4 item 2 says "Claude Code will build the CI fixture when the key is about to be flipped": done in the accompanying code PR.
- The preview's expected result of zero depends on the Annual grant staying live: if it is revoked or its window ends, the same key
  would list Grey Matter. Re-run the preview on the day, not from this document.
- The cap SQL above uses `public.orgs`; if the cloud schema is renamed the query fails harmlessly (read-only).

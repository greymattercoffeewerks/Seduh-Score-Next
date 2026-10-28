# Seduh ID Layer 1 (and the archive pipeline) — spec DRAFT

_Status: **DRAFT for the owner to decide on. Not locked.** Written 2026-10-28. Design only: no migration, no schema, no code, nothing run against the cloud. Every product choice below is a recommendation until the owner answers section 7. Companions: `MULTI-TENANCY-AND-SEDUHID-SCOPING.md` (the "why"; section 10 is the 2026-10-26 reference review), `GATING-SPEC.md` (the archive rules, D-G20 to D-G23), `HANDOFF-CORRECTION-002.md` (tenancy rules every table here must follow), `ADMIN-CONSOLE-SPEC.md` (D-A4), `Seduh-Score-Next-Infrastructure-Plan-14-Oct.md` (step 4), `TENANCY-WORK-PLAN.md` (the shape of section 6)._

_Verification convention. Statements about existing code or schema were checked by reading the repo on 2026-10-28 (branch off `dev` at `9cc27d7`) and carry a file reference. **[UNVERIFIED]** marks anything not checked, and why. The cloud project was not queried in this session._

---

## 0. Summary

1. **Layer 1 is small on purpose:** a private identity table keyed by a validated E.164 phone, a database-controlled link from each organisation's own `people` row to it, and a staff/affiliate roster that each organisation keeps about its own people. **No login, no profile, no results history, no new public page** beyond a one-page statement of purpose.
2. **The archive pipeline is a policy precondition, not a technical one.** The identity, the link and the roster need only the E.164 groundwork. Feeding the directory from published results needs the Community auto-publish (D-G22), which is not built. Recommendation: split Layer 1 into **1a** (E.164, identity table, link, roster, and a one-time backfill of identities from results already published) and **1b** (the ongoing archive feed from the Community auto-publish), and ship 1a first. After review, identities are created only from a published non-test result (or by admin), never by the link function.
3. **The biggest decision is the audience of the "directory".** The scoping doc's legacy wording is a public read-only registry. Nobody in a directory built from organiser rosters has consented to anything, and consent can only exist once a person can log in (Layer 2). Recommendation: **at Layer 1 no identity field is readable by any API role**; organisations see only their own `people` snapshots and their own roster, and the public sees only what the archive already shows.
4. **The identity key is a random uuid plus a unique, check-constrained E.164 phone**, stored in the `app` schema (the platform-table pattern) and reached only through `SECURITY DEFINER` functions. `people.global_person_id` gets a foreign key and becomes database-written only (closing an open item from T-TEN.B1/B2/B5).
5. **Nothing here is modelled on `seduh_links` or on the BNCC pricing and lock.** `seduh_links` does not exist anywhere in the repo (section 3.8). Items near them are listed in section 8 as requiring the owner's sign-off and are not decided here.

---

## 1. Scope

### 1.1 In Layer 1

| # | Item | Notes |
| --- | --- | --- |
| L1-1 | **E.164 phone check first.** Audit the stored `people.phone` values, normalise them, then enforce the shape in the database. | Sequenced before anything else (infrastructure plan, step 4: "confirm stored numbers are normalised to E.164 before any backfill"). |
| L1-2 | **Identity table** (names only) with a unique E.164 phone. | Private. Section 3.2. |
| L1-3 | **The link**: `people.global_person_id` becomes a real, database-written reference to an identity. | Section 3.3. |
| L1-4 | **Staff/affiliate roster (C3)**: an organisation records that one of its own people is staff or affiliated. | A tenant table. Section 3.4. |
| L1-5 | **Organiser screen** for the roster and a "linked" indicator on the people list. | Client work, after the functions exist. |
| L1-6 | **Platform-operator oversight**, counts and an audited identity merge only. | Subject to the D-A4 decision (section 3.7, decision 7). |
| L1-7 | **A8: a one-page public statement of purpose.** | Copy only, owner's voice, owner's BNCC check. |
| L1-8 | **1b only: the archive feed.** Identities are created for people named in a published result. | Needs the archive pipeline (section 2). |

### 1.2 Not in Layer 1 (so nobody builds it by drift)

- Competitor login, claiming, or any `auth.users` row for a competitor (Layer 2).
- Cross-organisation reads of any kind, and the cross-org RLS pattern (Layer 2, its own spec and `security-reviewer` pass). Concretely: **an organisation never learns that a person it holds also exists in another organisation.**
- Any results history, head-to-head, or "entries" table, platform-linked or self-attested (Layers 2 and 3).
- Registration page and payment tracking (D-G16, scoping 6.2; Layer 2).
- Professional profile, exportable CV, cafe directory, "open to opportunities" flag (Layer 3; A4, A5).
- Founding numbers, a completeness bar, role breadth on entries, field-level privacy settings (Layer 2; A2, A3, A6 as entries, A7).
- BTC competitors. **Verified:** `btc_teams` and `btc_judges` hold a name and an event only; neither links to `people` (`supabase/migrations/20260918090000_btc_tables.sql:27-45`). BTC is therefore outside the directory until BTC rosters link to people, which is a separate piece of work.
- Guess the Bean participants. Its contacts are deliberately privacy-split and unnormalised (`contacts.phone`, `20260914120000_guess_the_bean_tables.sql`). Keep them out of the identity pool.
- Legacy history import (a separate ETL job, infrastructure plan step 5).
- Gating of Seduh ID. Proposed by scoping A3 and kept here as a rule: **the identity and any future number or profile are free and never an entitlement key** (needs the owner's confirmation, decision 10).

### 1.3 The 2026-10-26 reference-review adoptions that touch Layer 1

| ID | Proposal | Verdict | Reason |
| --- | --- | --- | --- |
| A1 | Provenance marker reserved | **Adopt (reservation only)** | Layer 1 has no entries, so there is nothing to mark yet. What is reserved: an identity carries a `source` column (`organiser_roster`, `archive`), and this spec fixes the Layer 2 vocabulary for entries now (`platform_linked`, `self_attested`) so the Layer 2 spec does not rediscover it. Deciding wrong costs nothing at Layer 1. |
| A3 | Founding numbers assigned on claim only | **Adopt the rule; build nothing** | Layer 1 creates identities that have never logged in, so a number can only be assigned at claim. **No number column is added at Layer 1**: a nullable column added later is a cheap migration, and a dead column invites a passive assignment. Cohort sizes, the bar, the window and erasure (retire, never reissue) stay open under scoping 6.6. |
| A6 | Extensible affiliation `relationship` | **Adopt** | `relationship` is free text with a format check, not an enum, so judge, coach, steward and volunteer can reuse it. Starting vocabulary in the UI: `staff`, `affiliate`. Caveat in 3.4: do not let it encode commercial relationships. |
| A8 | Public statement of purpose | **Adopt as copy, gated by the owner** | One page, owner's voice. It must say that a person's record belongs to them, results are recorded by the platform, payments stay manual. It also needs the owner's BNCC conflict-of-interest check before it is published (section 8). Not a build task for Claude beyond a draft. |
| A2, A4, A5, A7 | Completeness bar, CV, opportunities flag, privacy defaults | **Defer** | Layer 2 or 3 per the scoping doc. A7's content (what is public, org-visible, private) is answered for Layer 1 in section 3.5 so Layer 2 starts from a default. |

---

## 2. The archive pipeline

### 2.1 What the scoping doc and ROADMAP make it

- ROADMAP (Seduh ID section, line ~1945): Layer 1 is "Not started; follows the archive pipeline".
- Infrastructure plan, step 4: "Community-tier archiving is compulsory, so the archive is what feeds the directory. Build them together."
- GATING-SPEC 6b/6d: **Community results are always listed; on Per-event and Annual listing is optional** (D-G21: a tick box, an unticked event is still named, with name, date and organiser and no results). The podium (top three) is published **automatically 24 hours after the champion is declared / the event is ended** (D-G22), with a warning and an early "publish now" for the organiser. "Enforcing the compulsory listing (the archive pipeline) stays in step 4" (GATING-SPEC section 6b "Archive rule").

So the archive pipeline is **the compulsory, automatic, fail-open publish of a Community event's podium when it ends, plus the optional listing for the paid tiers, plus the named-only entry.** It is the thing that makes the public archive complete, and, in the owner's plan, the feed of the directory.

### 2.2 What already exists (verified)

| Piece | Where |
| --- | --- |
| `public_results` table: one snapshot per event, anon-readable, org-writable, with an org-match and `is_test` trigger | `20260917130000_public_results.sql` |
| `publish_event_results` / `unpublish_event_results` RPCs, SECURITY INVOKER | same file; later hardened by `20261011140000_tenancy_rpc_null_org_guard.sql` |
| Stamping of the organiser's name and slug into each payload by trigger (`trg_public_results_stamp_org`) | `20261011170000_tenancy_anon_expand.sql` (named in `core/publicResults.js` header) |
| Client wrappers `listPublishedResults`, `findPublishedResultForEvent`, `publishEventResults`, `unpublishEventResults`, `getScoringRecord` | `src/core/publicResults.js` |
| Cup Taster payload builder (podium or full standings; fixed fields only, no phone or email) | `src/formats/cup-taster/resultsPublishing.js` |
| Archive page and per-event results sheet | `src/marketing/resultsScreen.js`, `resultsSheet.js` (named in ROADMAP) |
| **The "event ended" fact**: `events.ended_at / ended_by / ended_via`, `finish_event`, `admin_event_release`, the `events_open` cap | `20261023130000_entitlement_open_events.sql` (pushed to the cloud 2026-10-26 per ROADMAP; **the cloud was not re-checked here**) |
| Catalog key `results_archive_optional` (min tier `per_event`) | `supabase/entitlements.catalog.json:58` |

### 2.3 What is missing (the pipeline proper)

1. **The auto-publish itself** (D-G22): a database-owned timer path that publishes the podium 24 hours after `ended_at` on Community, failing open, visible to the organiser first. No scheduler exists for it (**[UNVERIFIED]**: not searched for a pg_cron or Edge Function equivalent beyond `grep` for `finish_event`; confirm in the task).
2. **BTC's "ended" fact** (GATING-SPEC G-B3 is still open). BTC is Per-event/Annual only after the 2026-10-23 reversal, so BTC does not block the Community pipeline.
3. **The D-G21 tick box and the named-only unlisted entry** in the archive.
4. **The Privacy and Terms wording** that Community results are public, held back until enforcement (GATING-SPEC "Archive rule").
5. **The archive page's scaling limit** (ROADMAP "T-TEN.D3": it downloads every payload; fine to roughly 300 results). Not a Layer 1 blocker.
6. **A link from a published result to an identity.** Today `public_results.payload` is opaque JSON of names; it carries no person id and **must not start carrying one** (a public payload with internal ids is an enumeration aid). The feed is server-side: a database path that, at publish time, follows `event_entries.person_id` to `people.global_person_id` (section 3.6).

### 2.4 Is it a precondition? Recommendation

For 1a (E.164, identity table, link, roster) **no**: nothing in them reads `public_results`. For the directory to be "fed by the archive" (1b) **yes**: the feed needs a publish that actually happens for every Community event. Recommended split:

- **1a** first, because it is where the E.164 audit and the privacy shape are decided and it unblocks Liga's need to recognise a person across rounds.
- **1b** after the Community auto-publish ships, and only the "identity created on publish" trigger.

This does re-order the owner's sequence slightly ("archive, then Layer 1"). The owner decides (decision 2). Cost of deciding wrong: if 1a is delayed to wait for the pipeline, the E.164 cleanup and the link slip behind a large unrelated task; if 1a ships first and the owner prefers one drop, nothing is wasted (1b only adds a trigger).

---

## 3. Data model proposal

Recommendation and options are given for each part. Names are proposals.

### 3.1 Where the identity table lives

| Option | What | For | Against |
| --- | --- | --- | --- |
| **P-app (recommended)** | `app.seduh_identities`, platform-table pattern (CONVENTIONS "Platform tables and admin functions"): RLS on, no policy, ACL naming only the owner, every access through `SECURITY DEFINER` functions. | An identity belongs to no organisation, so it is not a tenant table; `040`/`042` need no exemption (they cover `public` only); no API role can read a row even by mistake; `050` enforces the ACL shape. | The convention was written for admin tables; the identity table is mutable and read by org-level functions, so `050`'s "functions touching platform tables are DEFINER, `search_path = ''`, not executable by anon/service role" must be extended to allow `authenticated` for the link function only (a deliberate, reviewed exception). |
| P-public | `public.seduh_identities` with RLS and no policy for API roles. | Visible to the generated types and the PostgREST schema. | `040` demands every `public` table be in its tenant matrix, which does not fit; an accidental later policy exposes everyone's phone. |

### 3.2 `app.seduh_identities` (proposed)

| Column | Type / constraint | Why |
| --- | --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` | The surrogate key. Random, never derived from the phone. |
| `phone_e164` | `text not null unique`, `check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')` (the pattern of `E164_PATTERN`, `src/core/phone.js:15`) | The match key. Never null: for an opted-out identity it stays as the suppression record (3.5, E1). |
| `display_name` | `text`, `check (status = 'opted_out' or (display_name is not null and char_length(display_name) between 1 and 120))` | Untrusted metadata, not a canonical name: taken from the first published record that created the identity, truncated to 120. Blank for an opted-out identity. Never shown to another organisation at Layer 1. |
| `country` | `text`, nullable | Carried over from `people.country` if present. |
| `source` | `text not null check (source in ('organiser_roster','archive'))` | A1 reservation: how the identity came to exist. Extensible by migration. |
| `status` | `text not null default 'active' check (status in ('active','opted_out','merged'))` | See 3.5 (erasure) and 3.6 (a merged identity stays as a tombstone with a nullable `merged_into`). |
| `created_at`, `updated_at` | `timestamptz not null default now()` | `app.set_updated_at` trigger as elsewhere. |

No email column (see key options below), no `auth.users` reference, no founding number (A3), no claimed-by (Layer 2 adds them, nullable).

Companion: `app.seduh_identity_merges (id, kept_id, merged_id, merged_at, merged_by, reason_code)`, the ledger for the audited merge (3.7), `merged_id` a bare uuid as in `person_merges` (`20260821200000_core_tables.sql`), append-only by the same trigger pattern as `app.admin_audit_log`. **`reason_code` is a fixed list (`duplicate_person`, `phone_changed`, `recycled_number`, `other`), never free text**: this ledger and `app.admin_audit_log` are append-only, and `app.admin_audit_detail_ok` checks keys only, never values (`20261014110000_admin_audit_log.sql:60-69`), so a typed phone would be kept for ever. Neither ledger stores a phone or a name; identity ids survive erasure by design.

### 3.3 The identity key and the link

**Options for the key behind `people.global_person_id`:**

| Option | Description | Verdict |
| --- | --- | --- |
| **K1 (recommended)** | Surrogate uuid (`seduh_identities.id`); phone in E.164 is a unique match attribute. | Simple, reversible (the key never changes when the phone does), matches the owner's decision that phone stays the key (scoping 10.3). Weakness: a phone number is recycled or shared, so one identity can wrongly cover two people. Mitigation: no history is exposed at Layer 1, and the audited merge/unlink can repair it. Layer 2's claim step (proof of control of the number) is where a recycled number is actually settled. |
| K2 | The E.164 string itself as the key. | Rejected: it puts a phone number in every foreign key, URL and log, and a number change becomes a rewrite of every reference. |
| K3 | A keyed hash (HMAC) of the phone in the table, raw phone nowhere. | Would reduce the harm of a database leak. Rejected for Layer 1: needs a secret held outside the repo and rotation, and the organisations already hold the raw phones. Revisit if the opt-out suppression list (3.5) is the only place a number remains. |
| K4 | Verified email as a second key (the reference site's order). | Deferred, not adopted: scoping 10.3 keeps phone as the key; `people.email` is optional and unverified. A nullable second key can be added when claim exists. |

**`people.global_person_id`, concretely.** Today it is a nullable, unconstrained `uuid`, with a partial index, writable by any org member to any value (**verified**: `core_tables.sql:66,83`; `people_write` is `for all` on `app.is_org_member(org_id)`; ROADMAP "Known open items from T-TEN.B1/B2/B5" records it). Proposal:

- Add `foreign key (global_person_id) references app.seduh_identities(id) on delete set null`. Nullable stays: most people will never be linked.
- Add a `BEFORE INSERT OR UPDATE` guard trigger on `people`: an API caller cannot set or change `global_person_id`; **and when `phone` changes, the trigger sets `global_person_id` to NULL** (a stale link would otherwise keep a person tied to the old number's identity: `update_roster_entry` and a direct update both rewrite `phone`, `20261007100000_update_roster_entry.sql:137`). The next link call re-evaluates. Prefer a transaction-local flag set only by the link and merge functions over `guard_event_ended`'s deny-list of roles (`20261023130000_entitlement_open_events.sql:178-184`), which a future DEFINER function copying client data into `people` would silently bypass; or add a catalog test that no other function writes the column. The FK's `ON DELETE SET NULL` runs as the table owner and passes by design. This closes the FK existence oracle and the 'write any uuid' item. **Any cloud rows that already hold arbitrary uuids need an audit before the FK is added** (it would fail on them).
- The existing `before update` trigger freezing `org_id` on `people` stays (`trg_people_org_immutable`, `20261011100000_tenancy_org_id_immutable.sql:33`).
- **Backfill (revised after review)**: only after L1-1 passes, and **only from published, non-test results**, never from every `people` row (that would copy every phone list ever entered into a table, contradicting decision 3). A one-time, owner-run, idempotent step runs as `postgres` or through the SQL runner (the guard denies the `service_role` API role); it creates identities and links the `people` rows behind already-published events' entries. Rows whose phone fails the shape are skipped and listed, never guessed.

**The link function**: `public.link_person_identity(p_org_id uuid, p_person_id uuid) returns void`, `SECURITY DEFINER`, `search_path = ''`, executable by `authenticated` only. It opens by refusing a non-member with the standard 42501 via `app.refuse_non_member(...)` (**verified** to exist: `20261013160000_tenancy_trigger_membership_gate.sql:100`), whatever ids the caller names, a NULL org included. **It only FINDS an identity for the own-org person's phone; it never creates one** (review finding: a function that creates would let any member mint an identity, with a name they chose, for any phone, by inserting a `people` row first). Creation is server-side only: the archive feed from a published non-test result, the admin path, and the owner-run backfill. It returns nothing and sets the link whenever an identity exists, **including an opted-out one** (an opted-out identity is linked but inert: the feed, Layer 2 and any future read ignore it), so the readable `people.global_person_id` can never tell a member which phones objected. A rehearsal person is never reached, since creation needs a published non-test result. There is no `app.org_id_for_person` resolver today (**verified by grep of `supabase/migrations`**); the task adds an internal one (the B6 `_internal` pattern).

*Remaining signals, accepted and named:* (1) a member can insert a `people` row with any phone and call the link; whether `global_person_id` ends up set reveals that **a published, non-test result exists for that phone**. That is the fact the public archive already shows by name, but by phone it is a new, weak oracle; `security-reviewer` must decide whether to accept it or to expose only a boolean 'linked' and withhold the uuid. (2) Two organisations see the same uuid for the same person, so a **member of two organisations** can correlate (tenancy supports such members): 'useless without a door' overstated it; accepted at Layer 1 and stated here, or key the exposure per organisation. Timing differs by microseconds (B6 recorded the same class).

### 3.4 `public.org_person_affiliations` (tenant table, C3)

The scoping sketch is `(org_id, seduh_identity_id, relationship, created_at)`. **Recommendation: reference the organisation's own `people` row, not the identity.** Reasons: the table then lives entirely inside one organisation (no cross-org id on it, no oracle), the identity is reachable through `people.global_person_id` when it is needed, and a person with no identity yet can still be on a roster. This changes the sketch, so it is decision 9.

| Column | Type / constraint |
| --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` |
| `org_id` | `uuid not null references orgs(id) on delete cascade` |
| `person_id` | `uuid not null references people(id) on delete cascade` |
| `relationship` | `text not null`, `check (relationship ~ '^[a-z][a-z_]{1,39}$')` (A6: extensible, not an enum) |
| `started_on`, `ended_at` | `date`, `timestamptz`, nullable. Leaving staff ends a row; it does not delete history. |
| `created_at`, `created_by` | `timestamptz not null default now()`, `uuid references auth.users(id)` |
| unique | `(org_id, person_id, relationship) where ended_at is null` |

Tenant-table checklist (CONVENTIONS, "How to add a tenant table"), item by item:

1. Scope: `org_id` column.
2. RLS on, `_read` and `_write` policies on `app.is_org_member(org_id)`, `WITH CHECK` on the write one. **Never a policy reading `org_members` directly.**
3. Freeze parents: `app.forbid_parent_change('org_id', 'person_id')` in the creating migration.
4. Base grants explicit in the same migration (Supabase stops auto-granting `public` tables to API roles from 2026-10-30, per the checklist): `authenticated` only, no `anon`.
5. Two ids that must agree (`org_id` and the person's org): a cross-reference trigger opening with `app.refuse_non_member`, comparing with `is distinct from` (the B6 lesson).
6. No view and no anonymous door.
7. Added to `040_cross_org_matrix.sql`, and `link_person_identity` plus any roster RPC to `041_cross_org_rpcs.sql`.
8. Cloud push as a separate, owner-approved step; compare `list_migrations`.

**Caveat on `relationship` (touches section 8).** A free-text vocabulary invites a value such as `sponsor`, `partner` or `client`. Because the roster is organisation-private at Layer 1, the risk is contained; the moment any roster field becomes visible to another organisation or the public, the vocabulary needs the owner's sign-off.

### 3.5 Who can read and write what; public versus org-private

| Data | API read | API write | Public |
| --- | --- | --- | --- |
| `app.seduh_identities` (phone, name, source, status) | **Nobody.** No grant, no policy. | **Nobody.** `link_person_identity` (members, own org's person rows) and admin functions only. | Never at Layer 1. |
| `people.global_person_id` | The organisation's members, through the existing `people_read` policy, on their own rows. The value is an opaque uuid and is useless without a door. | **Nobody via the API** (guard trigger). | No. |
| `org_person_affiliations` | The organisation's members. | The organisation's members (ownership: any member, consistent with `people_write`; **decision 8** asks whether roster edits should be owner-only). | No. |
| `app.seduh_identity_merges` | Platform admins through an audited function only. | Admin merge function only. | No. |
| The archive (`public_results`) | Anyone (anon), unchanged. | Organisation members through the existing RPCs. | Yes, unchanged. Layer 1 adds no field to the payload. |
| The A8 statement of purpose | Anyone. | n/a | Yes. |

**This answers scoping 6.8 for Layer 1 only:** everything about an identity is private, and "public by default" is a Layer 2 question decided together with opt-in. A person is not asked anything at Layer 1, so nothing about them may become more public than it already is.

**Erasure and opt-out.** A person who asks not to be linked across organisations must be honoured even though each organisation still holds their phone (otherwise the next roster entry recreates the identity). Options:

| Option | What | Verdict |
| --- | --- | --- |
| **E1 (recommended)** | `status = 'opted_out'`: the name is blanked, the link function never links that phone, existing `people.global_person_id` values are set null. The phone stays in the identity row as a **suppression record**, documented as such. | Honours the request in practice; keeps the minimum needed to keep honouring it. Needs a legal read (decision 6). |
| E2 | Delete the identity row entirely. | Loses the suppression: the identity is recreated at the next link. Only works if the link is suspended per phone elsewhere. |
| E3 | Suppress by keyed hash (K3). | Best for data minimisation; adds secret management. |

Organisation-level removal (`people` rows) is unchanged and remains each organisation's own process; the existing "asking us to remove or correct your data" route stands (GATING-SPEC "Archive rule"). Founding-number retirement on erasure (A3) is Layer 2.

### 3.6 Duplicate handling and merge

- **Within an organisation:** already prevented by the unique indexes on `(org_id, phone)` and `(org_id, lower(email))` (`core_tables.sql:84-85`), and repaired by `merge_people` (original `20260822090000_registry_org_check_and_merge_rpc.sql:81`; the current body is in `20260830130000_rpc_search_path_pin.sql`, about line 50), which is SECURITY INVOKER, repoints `event_entries`, writes `person_merges` and deletes the merged person. **Interaction to handle:** `merge_people` deletes the merged `people` row, so its `global_person_id` disappears; if the kept row is unlinked and the merged one was linked, the link is lost. The kept row is re-linked by phone on the next link call, so nothing wrong results. The task adds a pgTAP case; no change to `merge_people` is needed. **Roster rows:** `merge_people` deletes the merged `people` row, and `org_person_affiliations.person_id ... on delete cascade` would silently drop its roster rows with no ledger entry. The task therefore replaces `merge_people` (from its current definition; check for a later replacement first) to repoint the merged person's affiliation rows to the kept person (with a pgTAP case for the unique collision), or uses a restrictive FK and handles it explicitly.
- **Across organisations:** the same human under two different phones becomes two identities. Layer 1 does not try to detect this. The repair is an **admin-only audited merge**: `admin_identity_merge(p_kept, p_merged, p_reason)`, which repoints `people.global_person_id`, retires the merged identity, writes the merges ledger and `app.admin_audit` (`identity.merge`), in one transaction, reason required, following the rules in CONVENTIONS "Platform tables and admin functions" (opens with `perform app.require_platform_admin();`, stable hints, change and audit row in one transaction). Needs the merge screen to show two names and masked phones, which is the D-A4 question below. **Durability:** with `phone_e164 unique`, a retired identity would be recreated by the next feed for its old phone. The merged identity therefore stays as a tombstone with a nullable `merged_into`, and the feed and the link resolve through it; an admin unlink writes a `do_not_link` marker the same way.
- **Same name, different people:** a non-issue; the key is the phone.
- **Recycled or shared number:** one identity covering two humans. Layer 1 exposes no history, so the harm is nil today. An admin **unlink** (set the link null for one organisation's person row) is the repair. Layer 2 has to settle it at claim.

### 3.7 Admin console exposure (decision 7)

ADMIN-CONSOLE-SPEC D-A4, restated in CLAUDE.md: the console shows "organisation names, link names, members, counts and dates, and no participant data: no event, score, entry or person". A directory of names and phones **is** people. Options: (a) counts only, no merge screen (merges by SQL as the owner); (b) counts plus a merge screen that shows two display names and the last four digits of each phone, which needs D-A4 amended; (c) full lookup. Recommendation: **(a) for the first release, (b) after the owner amends D-A4 deliberately.** Cost of deciding wrong: (c) turns the operator console into a people-search tool behind one password and a 60-minute TOTP window.

### 3.8 What touches `seduh_links` or the BNCC pricing and lock (requires the owner's sign-off; not decided here)

- **`seduh_links` does not exist** in migrations, source or specs (`grep -rn seduh_links` over `supabase/`, `src/` and the `Handoffs and Specs/` folder finds only the two sentences saying it needs sign-off: ROADMAP.md line ~1941 and the infrastructure plan line 74). **[UNVERIFIED]** what it means or where it lives (the legacy `Seduh-Score` repo was not read). Nothing in this draft reads, writes, extends or names it. If it is a link between an organisation and a competition body, it is exactly the kind of table a directory design could drift into.
- **BNCC pricing and the three-year lock** (the public pricing tier, the lock, the removable module): this spec contains no price, no tier rule for Seduh ID other than "never an entitlement key" (A3, decision 10, which is itself a pricing statement and therefore the owner's), and no relationship value that is commercial. A8's statement and the affiliation vocabulary are the two places the conflict-of-interest safeguards could be touched.
- Everything in section 8 is listed as owner sign-off; none is decided.

---

## 4. Security and privacy review surface

### 4.1 For `security-reviewer` (blocking, per the Definition of Done)

- `link_person_identity`: non-member, wrong org, NULL org, missing person, a person of a different org: **one indistinguishable 42501**. Live negative cases through PostgREST, not only pgTAP.
- **The enumeration-oracle lesson from Guess the Bean.** `app.session_is_open` once returned NULL for a missing session, so a nonexistent id produced a different, more specific error than a closed one (`20260914121000_guess_the_bean_rls.sql:55-80`, found by security-reviewer). For Seduh ID the same class appears three ways: (1) the FK on `global_person_id` (23503 versus success) — closed by the guard trigger; (2) the link function revealing "found" versus "created" — closed by returning nothing; (3) the cross-reference trigger on the roster answering before row-level security — closed by `refuse_non_member` first (the B6 lesson; six such triggers were fixed in `20261013160000`). Any boolean helper over the identity table must use `exists(...)`, never a scalar subselect.
- The guard trigger on `people.global_person_id`: insert and update, `ENABLE ALWAYS` is not wanted here (migrations and the owner must be able to backfill), so the test is "an API caller, including a two-organisation member, cannot set it to any value, including NULL-to-uuid and uuid-to-uuid".
- The `050` platform-tables contract. Correction from the schema review: `050` scans only functions outside `app` whose name or body matches `admin|platform|require_platform_admin|admin_audit|platform_admins` (`050:90-97`) and already expects them executable by `authenticated`; `link_person_identity` is not matched at all, so **its ACL needs its own pgTAP test**, and `admin_identity_merge` / `admin_identity_unlink` must be added to `050`'s exact list (and its description count) and to `041`'s exemption list (`041:253-267`) or CI fails. Make the tests enumerate by name so a second `authenticated`-executable writer of the identity table fails CI. The identity table's ACL also revokes everything from `service_role`, as the admin tables do (`20261014110000_admin_audit_log.sql:95-96`).
- Row-level security on `org_person_affiliations`: negative tests that a non-member reads zero rows and that a two-organisation member cannot move a row (parent freeze, SQLSTATE 23001).
- **`service_role` and `TRUNCATE`**: still holds `TRUNCATE` on tenant tables (ROADMAP B1/B2/B5 item); the new tenant table inherits that; revoke in its creating migration if the owner agrees.
- Cascades: deleting an organisation deletes its `people` and affiliations but **not** identities; orphan identities (no linked person) are a retention question (4.3).
- Audit detail must never contain a full phone number (`app.admin_audit_detail_ok` exists, `20261014110000_admin_audit_log.sql`; confirm what it forbids).
- Logging: PostgREST and function error text must not echo a phone.

### 4.2 For `schema-guardian`

- Every CHECK is real: the E.164 pattern on `phone_e164` and on `people.phone` (after backfill), the `relationship` format, the `source` and `status` vocabularies.
- **The `people.phone` CHECK and the fixtures.** The pgTAP matrix inserts `phone = '555-' || t` (`040_cross_org_matrix.sql:127`), and 11 pgTAP files insert into `people` (**verified**). **`NOT VALID` does not leave existing rows alone:** Postgres still evaluates the check on every UPDATE of a row, so an unrelated edit (a cafe change, or `update_roster_entry` rewriting the unchanged phone) of a legacy row with a non-E.164 phone fails 23514 at an event. Therefore: **repair the rows first (A1 audit, A3 backfill, A4), then add the CHECK**; `NOT VALID` only avoids a long scan, it is not a promise that legacy rows are tolerated. Backfill collision: if an organisation holds both `'81234567'` and `'+67381234567'`, normalising violates `unique (org_id, phone)` (23505); those are duplicate people and go to `merge_people` and the report. Fixtures move to a shared valid-phone helper. `supabase/seed.sql` has no phones (**verified**); `tests/e2e/support` was grepped with one pattern (**weak check**).
- `update_roster_entry` only trims the phone, it does not normalise. The body to start from is **`20261011140000_tenancy_rpc_null_org_guard.sql` (about lines 2700-2750: SECURITY INVOKER, `search_path ''`, with the null-org guard), not `20261007100000_update_roster_entry.sql:62`**, which it supersedes; a rollback that restored the 20261007 body would silently drop the B6 guard. With the CHECK in place it must normalise or reject; the client already does through `core/phone.js`. `CREATE OR REPLACE`; the rollback restores the 20261011140000 body.
- Indexes: `unique(phone_e164)` is the lookup; `people.global_person_id` partial index exists. The affiliation table needs `(org_id)` and the partial unique above.
- Rollback blocks, applies from empty, never edited after push; `seed.sql` cannot assume identities exist.
- Forward-compat: columns Layer 2 will add (`claimed_user_id`, founding number) are nullable additions; confirm nothing in 3.2 blocks them.
- Erasure and `on delete`: `set null` on the FK; confirm no cycle with `person_merges` (bare uuid by design).

### 4.3 Data-subject concerns for a directory of names

- **No consent at Layer 1.** The people were registered by an organiser for an event. The recommendation keeps that purpose: identities are private, used only to match the same person across the organiser's own records and (later) across organisations once they claim. If the owner chooses a public directory instead, it should be opt-in per person, which requires login.
- **Public exposure does not grow.** The archive already prints the podium (and, if chosen, the full standings) with names and cafes; Layer 1 adds nothing to it. The Privacy page already lags (ROADMAP "T-TEN.D3": it does not yet say the public sees the organiser's name); the Privacy and Terms wording for the archive is a precondition of 1b, and the identity table itself needs a sentence ("we keep a private record that links the same phone number across the organisations that registered you").
- **Phone numbers are the sensitive part**: stored once more in a table that is not exposed. Minimise: no email, no other contact data in the identity row.
- **Subject rights**: access, correction, erasure and objection need an operator procedure (opt-out, 3.5), and a statement of who is the data controller for the identity table (Grey Matter Coffee Werks as operator, presumably) as opposed to each organisation for its own roster. **[UNVERIFIED]** which law applies (Brunei's data protection regime and each competitor's own country, given the `country` field): a legal read is decision 6. Nothing here is legal advice.
- **Children.** Competitors can include under-18s (**[UNVERIFIED]**: no age data is stored; the product has no age gate). A cross-organisation identity for a minor should be raised with the owner.
- **Retention**: an identity with no linked person and no claim has no purpose. Proposal: an admin function lists them; deletion is a deliberate operator action (not automatic) until the retention rule is decided.
- **Breach impact**: a list of names with phones across organisations is a more valuable target than any one organisation's roster. This is the argument for not exposing the table to the API at all.

---

## 5. How it fits the tenancy rules (CLAUDE.md, Non-negotiables)

| Rule | How this design meets it |
| --- | --- |
| Every tenant table's parent is frozen | `org_person_affiliations` freezes `org_id` and `person_id`. `people.org_id` is already frozen. |
| Access is `app.is_org_member(...)` and nothing else | The roster uses it. The identity table is not tenant data and has no policy. |
| Cross-reference `BEFORE ROW` `SECURITY DEFINER` triggers open with `app.refuse_non_member` | The roster's org/person trigger does; `045`'s catalog guard must pass. |
| Anonymous people reach data only through narrow `SECURITY DEFINER` doors | **No new anonymous door at Layer 1.** |
| Organisations are provisioned only by the service role | Unchanged. |
| New tenant tables and RPCs go in the cross-org matrices | `040` for the roster; `041` for `link_person_identity` and any roster RPC. |
| Tenancy rules for audience links, slugs | Untouched. |
| Entitlements are a stub: no call site branches on a tier | Seduh ID adds no key and no branch. |
| `is_test` renders unmistakably | A test event's people must **not** create identities: the archive refuses test events already (`check_public_results_org`), and because identities are created only from a published non-test result, a rehearsal can never create one; a rostered person with no entries creates nothing. **Decision-free requirement**, tested. |
| `correct` is a count, never a column / `elapsed_secs` one writer | Not touched. |
| Vocabulary: "trio" banned | Not used. |

Module boundary (handoff section 6): any client code is format-agnostic and belongs in `src/core/` (the roster screen and `registry`-style wrappers), with no import from `src/formats/`. A format-specific screen that shows "linked" must get it through a prop. `module-boundary-checker` runs on the client tasks.

---

## 6. Task breakdown (T-ID.x)

Sizes: S (under a day), M (about a day), L (more). Reviewers follow CLAUDE.md "Delegation strategy". Codex means the task is safe to hand to Codex under `CODEX-HANDOFF-2026-10-27.md`'s rules (no migrations, no Supabase MCP, no cloud, no RLS or scoring; ends in an open PR that is never merged by Codex).

| Task | What | Size | Order | Reviewers | Owner |
| --- | --- | --- | --- | --- | --- |
| **T-ID.A0** | Lock this spec: owner answers section 7; write `HANDOFF-CORRECTION-004` (or equivalent) recording them. | S | 0 | code-reviewer, kb-sync | Claude |
| **T-ID.A1** | **Read-only audit of stored phones** (cloud): count of `people` rows by shape (valid E.164, missing `+`, local format, other), per organisation, no phone values in the report. Owner approves the cloud read. | S | 1 | none (report) | Claude (cloud access) |
| **T-ID.A2** | Client entry-path audit: every place that writes `people.phone` calls `normalizePhone` and `validatePhoneShape` (roster, import, walk-up, update_roster_entry, any CSV). Fix gaps; tests. | S | 1 | code-reviewer, test-auditor, module-boundary-checker | **Codex** |
| **T-ID.A3** | Migration: SQL port of the normalisation; `update_roster_entry` normalises; repair first, then the `people_phone_e164` CHECK (4.2: `NOT VALID` still blocks updates of legacy rows); pgTAP fixtures moved to a valid-phone helper; backfill script (dry-run first) that reports the ambiguous rows rather than guessing. | M | 2 | schema-guardian, security-reviewer, test-auditor, code-reviewer | Claude |
| **T-ID.A4** | Owner-run backfill in the cloud; then a second migration `VALIDATE CONSTRAINT`. | S | 3 | schema-guardian | Claude (cloud) |
| **T-ID.B1** | Identity tables (`app.seduh_identities`, merges ledger), ACLs, `050` contract extension, platform-table tests. No data yet. | M | 4 | schema-guardian, security-reviewer (blocking) | Claude |
| **T-ID.B2** | Internal person resolver, `link_person_identity`, the guard trigger and FK on `people.global_person_id`, pgTAP including the oracle cases, `041` entries. | L | 5 | security-reviewer (blocking, live cases), schema-guardian, test-auditor, scoring-auditor not needed | Claude |
| **T-ID.B3** | `org_person_affiliations`: table, policies, freeze, cross-reference trigger, grants, `040` entries, pgTAP. | M | 5 (parallel with B2, separate files) | security-reviewer (blocking), schema-guardian, test-auditor | Claude |
| **T-ID.B4** | Idempotent identity backfill from already-published non-test results (owner-run), orphan list. | M | 6 | security-reviewer, schema-guardian | Claude |
| **T-ID.C1** | `core/identity.js`-style wrappers for the roster and the link (thin RPC/table wrappers, no business logic) and the roster screen with a "linked" indicator on the people list, 360px first. | M | 7 | code-reviewer, module-boundary-checker, ui-accessibility-reviewer, test-auditor | **Codex** after the RPC names and hints are frozen in B2/B3; Claude reviews |
| **T-ID.C2** | Playwright: roster flows and the cross-organisation negative cases over HTTP (a stranger, a two-organisation member). | M | 8 | test-auditor, security-reviewer | Claude (it encodes the security expectations) |
| **T-ID.C3** | Admin: counts panel and the audited `admin_identity_merge` / `admin_identity_unlink`, per decision 7. | M | 8 (if decision 7 is (a): counts only, S) | security-reviewer (blocking), schema-guardian, ui-accessibility-reviewer | Claude |
| **T-ID.C4** | Privacy and Terms wording for the identity record; the A8 statement of purpose draft. **Drafts only; owner edits and publishes.** | S | 7 | owner | Claude drafts; **owner decides** |
| **T-ID.D1 (1b)** | Archive feed: on a Community publish, identities created for the podium's linked people (server-side; the payload gains no id). Depends on the archive pipeline. | M | after the pipeline | security-reviewer (blocking), scoring-auditor not needed, schema-guardian | Claude |
| **T-ID.Z** | Close-out: docs, ROADMAP, CHANGELOG `Reviews` line, cloud push comparison. | S | last | kb-sync | Claude |

**The archive pipeline tasks** (a separate spec/plan, listed so the dependency is visible; they belong to GATING-SPEC step 4, not to this document): ARC.1 Community auto-publish 24 hours after `ended_at` (fail-open, organiser-visible, with "publish now"), L, security-reviewer + schema-guardian blocking, Claude; ARC.2 D-G21 tick box and named-only entry, M, mostly UI, **Codex** after the RPC exists; ARC.3 Privacy/Terms wording tied to enforcement, S, owner; ARC.4 BTC ended fact (G-B3), M, Claude.

**What must stay with Claude Code:** anything with a migration, a `SECURITY DEFINER` function, RLS, a grant, the cloud, a backfill, the matrices, the admin gate, and the security tests. **What is safe to offload to Codex:** A2 (client audit), C1 (wrappers and the roster screen once the contract is frozen), ARC.2's UI, and copy drafts. Codex-owned PRs still get the full reviewer run from Claude before the owner approves a merge.

Suggested order of landing: A0, then A1 and A2 in parallel, A3, A4, B1, then B2 and B3 in parallel, B4, C1, C4, C2, C3, Z. 1b (D1) lands after the archive pipeline.

---

## 7. Owner decisions needed before any build (in order)

Each has a recommended answer and the cost of deciding wrong.

| # | Decision | Recommended answer | Cost of deciding wrong |
| --- | --- | --- | --- |
| 1 | **Who can see the directory at Layer 1?** (a) nobody beyond each organisation's own records; (b) the public sees podium names only, as today; (c) a public searchable directory. | **(a)+(b).** No new public surface. Public listing arrives with opt-in at Layer 2. | Wrong toward (c): people who never consented are listed under their names and (via cafe) their workplaces; hard to retract once indexed or scraped; the Privacy page lags the code. Wrong toward (a): the "regional directory" story waits for Layer 2; nothing is lost, only delayed. |
| 2 | **Split Layer 1 into 1a (E.164, identity, link, roster) and 1b (archive feed)?** | **Yes**; 1a first. | If no: Layer 1 waits on the Community auto-publish, an L task with its own risks. If yes and wrong: a small extra migration later. |
| 3 | **When is an identity created?** (I1) for every `people` row; (I2) when named in a published result or put on a roster; (I3) only from a published non-test result, and by admin. | **I3** (revised after review: a roster row is writable by any member, so it cannot be a creation precondition). The directory holds only people the platform already names publicly. | I1 builds a private copy of every phone list ever entered; I2 lets any member mint identities for any phone; I3 delays recognition of someone not yet in a published result (acceptable until Liga). |
| 4 | **The identity key:** surrogate uuid plus unique E.164 (K1), hash (K3), or email as the second key (K4)? | **K1**; no email column now. | Changing the key after links exist means rewriting every `global_person_id`; adding a second key later is a nullable column. |
| 5 | **Approve a read-only audit of stored phones in the cloud (A1), the default country (`+673`) for repairing local-format numbers, and the NOT VALID then VALIDATE route for the DB check.** | **Yes**, with ambiguous rows reported to the organiser, never auto-fixed. | A silent wrong repair gives one phone to the wrong person, which is the wrong identity everywhere downstream. A hard failing validation could block organisers from saving a roster at an event: hence NOT VALID first. |
| 6 | **Erasure/opt-out semantics and a legal read** (E1 suppression record recommended; controller; applicable law; minors). | **E1 plus a short legal review before 1b.** 1a stores no more than each organisation already holds. | Wrong: an erased person is silently relinked at the next roster entry; or a legal duty (data subject requests, cross-border) is discovered after the table is populated. |
| 7 | **Admin console exposure** (D-A4): counts only (a), counts plus masked merge screen (b), full lookup (c). | **(a) first**, (b) after a deliberate D-A4 amendment. | (c) makes the operator console a people-search tool behind one password and a 60-minute window. |
| 8 | **Who edits the roster?** Any member (consistent with `people_write`), or owners only? | **Any member**, as with `people`; revisit if rosters carry commercial meaning. | Owner-only blocks event-day staff from fixing a mislabel; any-member lets a team account change a staff roster. Low stakes. |
| 9 | **Affiliation references the organisation's own person row (recommended) or the identity (scoping sketch).** | **Own person row.** | Identity reference puts a cross-organisation id on a tenant table and invites a read-by-id oracle; person reference means a person must exist in the organisation first. Reversible only by a migration with data. |
| 10 | **A1/A3/A6/A8 as in 1.3, and: the identity, its eventual number and profile are free and never an entitlement key.** | **Adopt as written.** | A pricing statement: if the owner later wants a paid profile, an A3 "free" promise already made public becomes a retraction. |
| 11 | **Sign-off items near `seduh_links` and the BNCC pricing/lock** (section 8). | Owner answers each; this document decides none. | A conflict-of-interest safeguard is breached by a table design that nobody flagged. |

---

## 8. Items requiring the owner's sign-off (not decided here)

1. Anything that reads, writes, extends or is modelled on `seduh_links` (its meaning is **[UNVERIFIED]**, section 3.8).
2. Any relationship value, roster field or directory view that expresses a commercial arrangement (sponsor, partner, client, vendor) or would make an affiliation visible outside its organisation.
3. The A8 statement of purpose, against the BNCC conflict-of-interest safeguards (the public pricing tier, the three-year lock, the removable module).
4. The statement that Seduh ID is free and never gated (a pricing claim).
5. Anything that lets the directory influence, display or imply a price, a tier, a lock or a module's removability.

---

## 9. What this draft could not verify

- **The cloud database**: the content and shape of stored `people.phone` values, whether any `people.global_person_id` is set, and the exact current migration list. Only the repo was read. The gating migrations are recorded as pushed (ROADMAP, 2026-10-26/27) but not re-checked.
- **What `seduh_links` is.** Not in the repo; the legacy `Seduh-Score` repo (`STRATEGY.md`, `ROADMAP.md`) was not read.
- **A scheduler for the Community auto-publish.** Not searched beyond `finish_event`/`ended_at`.
- **`tests/e2e/support` and other test data for non-E.164 phones**: one grep pattern only.
- **The `app.admin_audit_detail_ok` contents** and what it forbids (named, not read).
- **The applicable data-protection law, the position of minors, and the controller question.** Not researched; no legal advice is given.
- **Supabase behaviour from 2026-10-30** (no auto-grant of new `public` tables) is taken from CONVENTIONS, not re-checked.
- Anything outside the repo; the section 10 findings come from agent reviews, not a human review.

## 10. Design review record

Design reviews run 2026-10-28 on the first version of this draft, read-only: `schema-guardian` and `security-reviewer`. Each Important finding was handed to a fresh agent that tried to refute it. Results, and what changed:

| Reviewer | Finding | Independent check | Outcome in this draft |
| --- | --- | --- | --- |
| security | Opt-out / test-event refusal made the link an oracle on which phones objected | Confirmed | Link only finds, never creates, and links opted-out identities too (3.3). Residual weak signal named (3.3). |
| security | Link function let any member mint identities for any phone (contradicted decision 3) | Partly: a roster row is member-writable, so I2 was not enough | Creation only from a published non-test result or admin; decision 3 is now I3. |
| security | Stale link after a phone change | Confirmed | Guard trigger nulls the link when `phone` changes (3.3). |
| security | Append-only ledgers vs erasure; free-text reason; `display_name` not null vs "blanked" | Confirmed, both halves | Reason codes; no phone or name in ledgers; `display_name` conditional on status; `phone_e164` never null (3.2). |
| schema | `NOT VALID` still blocks updates of legacy rows | Confirmed | Repair first, then the CHECK (4.2). |
| schema | Wrong `update_roster_entry` rollback source | Confirmed | Start from `20261011140000` (4.2). |
| schema | Backfill contradicted decision 3 | Confirmed | Backfill only from published non-test results (3.3). |
| schema | Merge not durable (unique phone) | Confirmed | `merged` tombstone with `merged_into`; `do_not_link` for unlink (3.6). |
| schema | `merge_people` cascade-deletes roster rows | Partly: real once the table exists | `merge_people` repoints affiliations (3.6). |
| schema | `050` misdescribed; `041` exemption missed | Partly | Corrected (4.1). |

Nits taken: transaction-local flag over a role deny-list, cross-org uuid correlation by two-organisation members stated, admin option (b) is itself a lookup oracle (stay at (a)), `service_role` revoked on the identity table, display-name length handling, rollback is data loss once populated (a `DROP` of the identity table after backfill cannot be undone). Nit not acted on: none dropped. Both reviewers note the required proof (the pgTAP non-member zero-rows test and live PostgREST negative cases) does not exist yet, which is expected for a draft.

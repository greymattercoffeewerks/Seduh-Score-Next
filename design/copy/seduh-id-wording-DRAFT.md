# Seduh ID Layer 1: Privacy, Terms and statement-of-purpose wording (DRAFT, T-ID.C4)

**Status: DRAFT for the owner. Nothing here is published or wired into the site.** Do not copy any of it
into `src/marketing/trustContent.js`, `privacy-page-draft.md` or `terms-page-draft.md` until the owner
has edited it and decided the points marked `[OWNER]`. Like `archive-rule-wording-HELD.md`, this file
exists so the wording is not lost; the owner edits and publishes.

**When the owner does publish it, in the same PR:** edit `trustContent.js` and both draft files together
(the drafts are the owner-edited source), update `PRIVACY_UPDATED`, run `trustScreen.test.js` (it fails if
a review marker reaches a page), and add any new public page to `vite.config.js`,
`public/sitemap.xml`, `tools/prerender-public-pages.mjs` and `tests/e2e/smoke.spec.js`.

**How the wording was checked.** Every statement below was read against the migrations in
`supabase/migrations/` (cited in the table at the end) and against `CONVENTIONS.md`. The wording
describes Layer 1 as built: a private record and nothing else. It makes no claim about login, profiles,
a CV, a directory anyone can search, or any later layer.

**Legal status.** The wording is plain-language product copy, not legal advice. Who is the controller of
the identity record is deliberately NOT settled here (marked `[LEGAL OPEN]`; see section 6). The owner
treats the Personal Data Protection Order, 2025 as in force for its substantive duties (section 6). The
owner's checklist of decisions is kept locally (`Handoffs and Specs/SEDUH-ID-C4-OWNER-CHECKLIST.md`, not
committed).

---

## 1. Privacy page

### 1a. "What we hold": add a block after "Competitors and event entries"

> **Seduh ID record** (a private record we keep that links the same person across organisers)
>
> - A phone number in international format, the name it was published under, and, if the organiser
>   entered one, a country.
> - It is created only when you are named in a published, non-test result, or by us on request.
>   Rehearsal ("test") events never create one.
> - It is linked to the entry for you in each organiser's own registry, so the same phone number is
>   recognised as the same person. If an organiser changes the phone number on your entry, the link is
>   removed and checked again.
> - It holds no email address, no results, no scores and no sign-in. Its contents are shown on no page,
>   public or private. An organiser's own people list shows only whether a person is linked.
> - An organiser can also record, for its own people, that someone is staff or affiliated with it.

`[LEGAL OPEN]` "we" / "Grey Matter" as the party that holds this record: whether the operator is the
controller of the identity table (as opposed to a processor for each organiser's registry) is not decided.
The Privacy page currently opens "Seduh Score is run by Grey Matter Coffee Werks"; keep that and do not add
the words "controller" or "processor" until counsel has answered.

### 1b. "Who can see it": add bullets

> - **The Seduh ID record is private.** No organiser, competitor or member of the public can read it,
>   and no page shows what is in it. An organiser sees only its own registry and its own entries; one
>   organiser cannot see another organiser's records, or what another organiser holds about you.
> - **Staff and affiliate lists** are kept by an organiser about its own people (for example, that
>   someone is staff). Only members of that organisation can see them. They are not shown to other
>   organisers or to the public.
> - **Our operator view shows totals only**: how many records exist and in what state. It does not show
>   names, phone numbers or which organiser anyone belongs to. Direct access to the database stays with
>   one person, as described above.

`[OWNER]` The last sentence repeats the existing "Grey Matter restricts direct access ... to one person"
bullet; drop it here if you prefer not to repeat.

### 1c. "Where it is stored" and "How long we keep it"

No new sentence is needed for storage (the record is in the same Supabase database in Singapore).
For retention, replace "There is no automatic deletion today" paragraph's second sentence only if you want
the record covered explicitly:

> A Seduh ID record has no automatic deletion either. It stays until we delete it.

`[OWNER]` As built, the operator can opt a record out but there is no removal procedure for it (see 1d). If
you will remove records on request, say "until you ask us to remove it (see below) or until we delete
it" and write the procedure first.
`[LEGAL OPEN]` Whether holding a record with no linked person and no purpose is acceptable, and for how
long, is a retention question for counsel. Orphan records (no person linked) can be counted by the
operator but nothing deletes them automatically.

### 1d. "Asking us to remove or correct your data": add to "Things to know"

> - **Asking us to stop using your Seduh ID record.** Email us and we will mark your record as opted out.
>   We remove the name from it and stop using it. **We keep the phone number on that record** so that we
>   can recognise it and honour your request; without it, a later result with the same number would
>   create the record again. It is used for nothing else. Organisers' own registries are separate: ask
>   the organiser, or us, to remove those as above.

`[OWNER]` Deliberately NOT promised: "stop linking you" or "remove the record". As built, opting out sets
`status = 'opted_out'` and blanks the name; the person's entries stay linked to the (now inert) record, on
purpose, so a member cannot tell which phones objected (`CONVENTIONS.md`, "Opt out";
`20261030140000_seduh_identity_link.sql` header item 5). Unlinking one organiser's person is a separate
owner-SQL step ("Unlink"). Decide whether an opt-out request also triggers unlinking and/or deletion; if so,
change the runbook first, then the wording.
`[LEGAL OPEN]` Keeping the phone as a suppression record is itself retention; the justification and the
notice wording need counsel.

### 1e. "Changes to this page"

Update the date at the top (`PRIVACY_UPDATED`) when publishing.

### 1f. Timing

`[OWNER]` The Seduh ID table has, per the B4 hand-over, already been populated in the cloud, so the Privacy page is already behind the data. Publishing the block in 1a is not
dependent on the later archive-feed work.

---

## 2. Terms page

### 2a. "The organiser is in charge of the event": add a bullet

> - If you register competitors, you are responsible for having the right to enter their phone numbers.
>   We use a competitor's phone number to recognise the same person across organisers in a private
>   Seduh ID record (see the [Privacy page](/privacy/)). Tell your competitors that.

### 2b. New section "Seduh ID"

> ## Seduh ID
>
> - Seduh ID is a private record that recognises the same person, by phone number, across the organisers
>   who use Seduh Score. It is not an account, a profile or a ranking, and it does not change any
>   result.
> - A match is made on the phone number only. It does not prove who a person is, and a number that has
>   been reused or shared can match the wrong person. If a record is wrong, email us and we will correct
>   it.
> - Seduh ID is free. It does not affect which plan an organiser is on, what an organiser can do, or what
>   anyone pays.
> - You can ask us to stop using your record at any time (see the [Privacy page](/privacy/)).

`[OWNER]` "Seduh ID is free ... does not affect which plan ..." is a pricing statement, not a description of
the code (nothing in the entitlement catalog mentions it, and entitlements are a stub). It binds you if
you later want a paid profile. Keep it only if you mean it.
`[OWNER]` Confirm "no ranking" is a promise you want to make before any later layer is designed.

### 2c. "Your data" (existing)

No change needed. "Event data belongs to the organiser" still describes the registry and entries; the
Seduh ID record is covered by 2b and the Privacy page.

---

## 3. Public statement of purpose (spec item A8)

A one-page statement, to sit where the owner decides (a short new page or a section of About). Not built.
Placement is the owner's: a new page needs the route wiring listed at the top.

> ### What Seduh ID is for
>
> People who compete in coffee events are registered by organisers, one event at a time. The same person
> turns up under different organisers and, with nothing to join the records, is a stranger every time.
>
> Seduh ID is a private record that joins them, using a phone number. That is all it does today. It is
> not public, it has no sign-in, and only the members of an organiser can see that organiser's records.
>
> - **Your record belongs to you.** `[OWNER]` See the note below before keeping this line.
> - **Results are recorded by the platform, and decided by the organiser.** Seduh Score works out the
>   standings from the scores an organiser enters; we do not change a result.
> - **Payments stay manual.** Seduh Score does not take payment for Seduh ID, and does not take payment
>   from competitors on an organiser's behalf. `[OWNER]` confirm the exact claim you want to make about
>   competitors' payments; today billing is manual for organisers.
> - **It is free.** `[OWNER]` pricing statement, same note as in the Terms.
>
> You can ask us to stop using your record at any time. See the [Privacy page](/privacy/).

`[OWNER]` "Your record belongs to you" is ahead of the code: at Layer 1 a person cannot log in, see,
claim or correct their record themselves; they can only ask by email. Either soften it ("You can ask us
what we hold and to stop using it") or keep it as a statement of intent and say so.
`[OWNER]` Sign-off items on the public statement (conflict-of-interest safeguards and what the page may
imply about pricing or other bodies) are pending and listed in the local checklist. Do not publish this
section until they are answered.

---

## 4. What each statement rests on (for the owner and reviewers)

| Statement                                                                                                  | Source                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record = validated E.164 phone, a name, optional country, `source`, `status`; no email                     | `20261030120000_seduh_identity_tables.sql` (`phone_e164` CHECK, `display_name`, `country`, `source`, `status`; no email column)                                                                    |
| Nobody (no API role) can read the record                                                                   | same file: RLS on, no policy, `revoke all` from `public, anon, authenticated, service_role`; schema `app`                                                                                          |
| Created only from a published non-test result, or by the operator; never by the link; never by a rehearsal | `20261031100000_seduh_identity_backfill.sql` (header: "NAMED IN A PUBLISHED RESULT", `events.is_test` excluded, API roles refused); `20261030140000_seduh_identity_link.sql` ("NEVER creates one") |
| The link from a person to a record; changed phone clears it; database-written only                         | `20261030140000_seduh_identity_link.sql` (guard trigger, FK, `public.link_person_identity`)                                                                                                        |
| An organiser sees only its own people and entries                                                          | tenancy rules in `CLAUDE.md` (`app.is_org_member`); a member sees on their own `people` row only an opaque identifier                                                                              |
| Staff / affiliate roster, members of that organisation only, relationship is free text with a format check | `20261030130000_org_person_affiliations.sql` (RLS on `app.is_org_member`, `authenticated` only, no view, no anonymous door); column grants in `20261031120000_affiliations_column_grants.sql`      |
| Opt-out = suppression record: name blanked, phone kept                                                     | `CONVENTIONS.md`, "Seduh ID link: the owner's runbook", "Opt out (E1)"; `seduh_identities_display_name_by_status` CHECK                                                                            |
| Opt-out is done by the operator by hand (no screen, no self-service)                                       | `CONVENTIONS.md` runbook ("There is no admin function or console screen for any of the following")                                                                                                 |
| No public surface in Layer 1                                                                               | no `anon` grant, no anonymous door, `public_results` payload gains no field (B1, B2, B3 headers)                                                                                                   |
| Operator view is counts only                                                                               | `20261031110000_admin_seduh_id_counts.sql` (`admin_seduh_id_counts()`, "COUNTS ONLY ... no names, no phones, no ids")                                                                              |
| Free, never an entitlement key                                                                             | **Not in code.** Spec decision 10 / `HANDOFF-CORRECTION-004.md` (local); the entitlement catalog has no Seduh ID key. A pricing statement: owner's.                                                |
| "Your record belongs to you", "payments stay manual"                                                       | **Not in code.** Spec A8 (local): wording the statement must carry; see the `[OWNER]` notes above                                                                                                  |

## 5. Deliberately not said

- Nothing about login, claiming, profiles, a CV, a directory, a founding number or later layers.
- Nothing that could imply a competitor can see which organisers hold them. The design accepts two weak
  signals (a member who types a phone number can learn whether a record exists for it; a member of two
  organisations sees the same internal identifier for the same person). The wording says one organiser
  cannot see another's records, which is true; it does not say "no organiser can ever learn anything".
- No legal term (controller, processor, lawful basis, consent) and no reference to a statute.

## 6. The Personal Data Protection Order, 2025 (owner's understanding; not legal advice)

**Commencement (owner-supplied, to be confirmed against the Gazette).** The owner understands, from
secondary sources (dataguidance.com, securiti.ai, DLA Piper; not from the AITI infokit, which states no
commencement dates), that Part 1 (scope, definitions) took effect on 1 January 2025 and Parts 3 to 9
(organisations' duties, data subjects' rights) on 1 January 2026, after a one-year grace period. The owner
treats the substantive duties as already in force. `[OWNER]` Confirm against the Gazette notice.

**Source for the points below:** AITI, "Personal Data Protection Essentials Infokit", January 2026
(owner's copy; page numbers are PDF pages). The infokit says its sample policies and tools are
illustrative only (p. 3). The timings below are the infokit's SAMPLES, not stated here as legal
requirements.

- Controller = an organisation with direct control over the means and purposes of processing; processor =
  one that processes on behalf of another organisation or a public agency (p. 5). **Who controls the
  identity record is not settled.** The operator decides the means and purposes of the identity layer,
  which points to controller; each organiser controls its own registry. `[LEGAL OPEN]`
- Duties listed: accountability including appointing a Data Protection Officer, with responsibility
  staying with the organisation; limiting collection, use and disclosure to what is reasonable; reasonable
  security and keeping data only when necessary; documenting data flows; publishing a data protection
  policy (pp. 5-8). The infokit encourages data minimisation (p. 16).
- A published policy should state types of data, methods and purposes of collection and use, disclosure,
  protection, transfers outside Brunei (to a comparable standard), amendments, DPO contact and date
  issued (sample policy dated 27 January 2026, p. 15).
- Sample timings: access request acknowledged within 3 working days and answered within 30 working days,
  fee allowed (p. 19); consent withdrawal acknowledged within 10 days (p. 35); direct marketing stopped
  within 30 days (p. 35); a data breach assessed within 30 days, AITI notified within 3 days of deciding it
  is notifiable, and affected individuals where reasonable (p. 21).

**Owner decisions this raises (each `[OWNER]`; none is settled in the wording above):**

1. **Who is the DPO**, and the contact address to publish (the site's contact address is still temporary).
2. **Controller or processor for the identity record**, with counsel (the table is the platform's own
   purpose; the registries are the organisers').
3. **Whether the opt-out record and the access/withdrawal handling can meet the infokit's sample timings.**
   Today there is no self-service: an opt-out, a correction or an access answer is the operator working by
   hand from an email (`CONVENTIONS.md` runbook). The Privacy page currently says "we aim to do this
   within 14 working days"; check that against the timings above before restating it for Seduh ID.
4. **Transfers outside Brunei.** The database is Supabase in Singapore (AWS ap-southeast-1), as the
   Privacy page already says. The wording for "comparable standard" needs counsel.
5. **Who owns the breach process** (assessment, notifying AITI and affected people).
6. **Data-flow documentation and the published policy.** The Privacy page is the published policy; the
   infokit's list (section above) has items the page does not yet carry (DPO contact, date issued,
   methods and purposes, transfers). Decide whether to add them with this change.

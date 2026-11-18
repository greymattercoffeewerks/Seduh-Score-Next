# Runbook: "This isn't mine" (results a person disputes)

Built as T-ID2.NM (migration `20261126100000_seduh_result_disputes.sql`, owner decision 2026-11-15, spec section 14.6). A result reaches a
claimed profile as "Recorded by Seduh Score" because an organiser's roster linked a person (by phone) to that identity. A wrong
phone can put a stranger's result on someone's page. In My Seduh ID, under **Recorded results**, the person presses **This isn't mine**
on one result. It leaves their public page, the Seduh ID search by cafe and the results-page profile link **at once**, for that person
only; the organiser's published results page is never touched. The dispute waits in `app.seduh_result_disputes` for you.

Review it **next to the weekly archive-feed review**. The person is waiting, and a result that is not theirs should not stay in doubt.

## The queue

Owner SQL (the SQL editor as `postgres`):

```sql
select * from app.seduh_disputes_overview();   -- pending first, oldest first
```

Columns: `dispute_id`, `status` (`pending`, `stands`, `link_wrong`), `handle`, `founding_number`, `display_name`, `event_name`,
`event_date`, `org_name`, `reason` (the person's own words, up to 200 characters, may be empty), `still_matches` (false once the
roster link was corrected: nothing is left to hide), `linked_person_id` (the roster person the result came through: your starting
point), `created_at`, `resolved_at`, `resolution_note`.

## Deciding

1. Open the event's roster, find `linked_person_id` (People screen of that organisation, or `select * from people where id = '<id>'`),
   and compare that person's phone with the claimed person. Ask the organiser if it is not clear (the contact is on the event).
2. Choose one outcome.

### (a) The link is wrong

The roster's phone number belongs to someone else (or a typo matched a stranger).

1. **Unlink the person** and correct the roster by the existing runbook ("Seduh ID link" in `CONVENTIONS.md`: unlink one organisation's
   person, durable). Do this BEFORE recording the outcome, so the wrong link cannot come back on the next roster edit.
2. Record it:

```sql
select app.seduh_dispute_resolve(<dispute_id>, 'link_wrong', 'Roster phone was a typo; unlinked, organiser told');
```

The result stays hidden for good and the person is told in My Seduh ID that it was linked by mistake. They cannot show it again.
Check the stranger's side too: if the same wrong link put the result on **another** claimed profile, that person may have a
dispute of their own, and `still_matches` shows it. If the correct person is known, the organiser's corrected roster links them
the normal way.

### (b) The result stands

The link is right and the result is theirs (they pressed it by mistake, or do not want it shown).

```sql
select app.seduh_dispute_resolve(<dispute_id>, 'stands', 'Checked with the organiser: it is theirs');
```

It stays hidden **at the person's request**, and My Seduh ID says "We checked: this result is yours" with a **Show it again**
button. Nothing else is needed. The person may instead keep it hidden; nobody can re-show it for them.

## The person can undo

While `pending`, and after `stands`, **Show it again** (door `seduh_withdraw_dispute`) deletes the dispute row and the result
returns to their profile at once. After `link_wrong` they cannot. Every open, withdraw and resolve writes an
`app.seduh_claim_audit` row (`result_dispute.open`, `.withdraw`, `.resolve`; the audit is append-only):

```sql
select at, action, identity_id, detail from app.seduh_claim_audit where action like 'result_dispute.%' order by id desc;
```

## Facts worth knowing

- A dispute belongs to the person's **account**. If an account is closed (undo-claim) and the person claims again, their results
  show again until they dispute again. A closed account's dispute hides nothing.
- The result is named by a one-way key of the event and the payload row (name and cafe). If the organiser edits the name on the
  roster after publishing, the result stops matching the profile anyway; the dispute row stays as the record.
- A person can mark at most 50 results. A deleted event takes its disputes with it.
- A test event, an unpublished event and a self-reported entry can never be disputed (they are not recorded results).
- Hiding ALL recorded results is a separate, older setting (`vis_recorded_results`); a dispute is for one result and goes to you.

## Tests

pgTAP `089_seduh_result_disputes.sql` (who may dispute, the hide effect on the profile and the C5 helpers, undo, the owner functions,
the rollback block). Playwright `seduh-not-mine-live.spec.js` (360px: confirm step, public page, queue, undo). Unit tests in `meFlow`,
`meApi`, `meScreen`.

-- Seduh Score Next · T-ID.A3 (part 2 of 2): the people_phone_e164 CHECK
--
-- Why: the Seduh ID identity key is a validated E.164 phone (SEDUH-ID-LAYER1-SPEC-DRAFT.md 3.3, 4.2). This puts the
-- shape in the database, where no caller can skip it.
--
-- ORDER MATTERS, and it is enforced here: DO NOT PUSH THIS MIGRATION UNTIL THE STORED PHONES HAVE BEEN REPAIRED.
--   1. push 20261029100000_phone_e164_normalise.sql  (safe at any time; changes no row)
--   2. run supabase/scripts/people_phone_audit.sql   (read-only; prints counts and row ids, never phone values)
--   3. run supabase/scripts/people_phone_repair.sql  (owner-run; repairs only the unambiguous rows)
--   4. deal with every row the audit still lists (ambiguous, not_a_phone, repair_collision): the organiser fixes or
--      the owner removes them. No script here deletes or guesses.
--   5. only when the audit shows nothing but 'valid': push THIS migration.
-- The constraint is added VALID, not NOT VALID, deliberately: Postgres still evaluates a NOT VALID check on every
-- UPDATE of an existing row, so an unrelated edit of a legacy row (a cafe change, update_roster_entry rewriting an
-- unchanged phone) would fail at an event with 23514. Repair first, then the CHECK.
-- The guard below makes an out-of-order push harmless: it refuses with the count (never a phone value), changes
-- nothing, and the migration can simply be pushed again after the repair.
--
-- people.phone is already NOT NULL (20260821200000), so "a phone may be null" holds only in the sense that the CHECK
-- itself never rejects NULL (a check on NULL is unknown, which passes); NOT NULL stays the other constraint's job.
--
-- Locks: ALTER TABLE ... ADD CONSTRAINT takes ACCESS EXCLUSIVE on people for one scan of the table (tens of rows
-- today). Run it outside an event.
--
-- rollback:
--   alter table public.people drop constraint people_phone_e164;

do $guard$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
  from public.people
  where phone is not null and phone !~ '^\+[1-9][0-9]{7,14}$';

  if v_bad > 0 then
    raise exception 'people_phone_e164: % row(s) in public.people hold a phone that is not E.164. Run supabase/scripts/people_phone_audit.sql, repair them, then push this migration again.', v_bad
      using hint = 'people_phone_not_repaired';
  end if;
end;
$guard$;

alter table public.people
  add constraint people_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$');

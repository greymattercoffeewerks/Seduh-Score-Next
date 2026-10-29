-- people.phone repair (T-ID.A3): OWNER-RUN. Not a migration. Run people_phone_audit.sql FIRST.
--
-- What it does: for each row the audit classes as repairable_format or repairable_default_country, and whose
-- repaired number would NOT equal any other number in the same organisation, it sets people.phone to the E.164
-- value (default country +673). That is all.
-- What it never does: delete a row; touch an ambiguous, not_a_phone or repair_collision row; change a row that is
-- already valid; guess a country code beyond the owner's +673 default for a bare 7 or 8 digit number.
-- The 12 short values and the nine-digit one in the cloud stay exactly as they are; they are for the owner and the
-- organiser to remove or fix by hand, then the audit must show only 'valid' before the CHECK migration is pushed.
--
-- It prints counts only, never a phone value. It ENDS IN ROLLBACK so a first run changes nothing and shows what
-- would change: read the counts, then change the last line to COMMIT and run it again.
--
-- Effects of an UPDATE on people: updated_at moves (trigger); org_id is not touched (it is frozen anyway).
-- Needs migration 20261029100000_phone_e164_normalise.sql. Run as the database owner.

begin;

create temp table _phone_repair on commit drop as
with classified as (
  select p.id, p.org_id, p.phone,
         app.phone_repair_class(p.phone) as base_class,
         case when app.phone_repair_class(p.phone) in ('repairable_format', 'repairable_default_country')
              then app.normalize_phone(p.phone) end as repaired
  from public.people p
),
targets as (
  select org_id, coalesce(repaired, phone) as final_phone, count(*) as holders
  from classified
  where base_class in ('valid', 'repairable_format', 'repairable_default_country')
  group by org_id, coalesce(repaired, phone)
)
select c.id, c.org_id, c.repaired
from classified c
join targets t on t.org_id = c.org_id and t.final_phone = c.repaired
where c.base_class in ('repairable_format', 'repairable_default_country')
  and t.holders = 1
  -- belt and braces: only ever write an E.164 value
  and app.is_e164(c.repaired);

update public.people p
set phone = r.repaired
from _phone_repair r
where p.id = r.id
  and p.phone is distinct from r.repaired;

-- counts only
select
  (select count(*) from _phone_repair)                                        as rows_repaired,
  (select count(*) from public.people)                                        as people_total,
  (select count(*) from public.people where app.is_e164(phone))               as people_valid_now,
  (select count(*) from public.people where not app.is_e164(phone))           as people_still_not_e164;

-- Change to COMMIT only after reading the counts above and re-running people_phone_audit.sql.
rollback;

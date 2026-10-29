-- people.phone audit (T-ID.A3): READ-ONLY dry run. Not a migration. Changes nothing.
--
-- Classifies every public.people row (all organisations) and prints, per organisation and class, a count and the
-- row ids. It never selects, prints or computes anything shown from a phone VALUE: only the class, the id and the
-- digit count (a length, to help the organiser find the row) leave the database.
--
-- Needs migration 20261029100000_phone_e164_shape.sql (app.is_e164, app.phone_repair_class).
-- Run as the database owner (the SQL editor, or the Supabase MCP's execute_sql). Safe to run any number of times.
--
-- Classes (one home for the rules: app.phone_repair_class):
--   valid                       already E.164
--   repairable_default_country  exactly a 7-digit Brunei number (^[2-578][0-9]{6}$ once spaces, dashes, dots and
--                               brackets are removed); '+673' would be added
--   repair_collision            repairable, but the repaired number would equal another number in the SAME
--                               organisation (an existing one, or another repair target): two people who look like
--                               duplicates. Needs merge_people / a human, never the repair script
--   ambiguous                   everything else (8 digits, a leading 0, a country code without '+', text): reported,
--                               never repaired
--   null_phone                  no value (people.phone is NOT NULL today, so expect 0)
--
-- Done when every row is 'valid': then, and only then, push 20261029110000_people_phone_e164_check.sql.

with classified as (
  select
    p.id,
    p.org_id,
    app.phone_repair_class(p.phone) as base_class,
    case
      when app.phone_repair_class(p.phone) = 'repairable_default_country'
        then '+673' || regexp_replace(p.phone, '[^0-9]', '', 'g')
      else null
    end as repaired,
    length(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g')) as digit_count,
    p.phone
  from public.people p
),
-- the numbers each organisation will hold after the repair: every valid number, plus every repair target
targets as (
  select org_id, coalesce(repaired, phone) as final_phone, count(*) as holders
  from classified
  where base_class in ('valid', 'repairable_default_country')
  group by org_id, coalesce(repaired, phone)
),
final as (
  select
    c.id,
    c.org_id,
    c.digit_count,
    case
      when c.base_class = 'repairable_default_country' and t.holders > 1 then 'repair_collision'
      else c.base_class
    end as class
  from classified c
  left join targets t
    on t.org_id = c.org_id
   and t.final_phone = coalesce(c.repaired, c.phone)
   and c.base_class in ('valid', 'repairable_default_country')
)
select
  org_id,
  class,
  count(*) as row_count,
  -- ids and digit counts for everything that is not already valid; nothing for valid rows
  case when class = 'valid' then null
       else jsonb_agg(jsonb_build_object('id', id, 'digits', digit_count) order by id)
  end as rows_to_look_at
from final
group by org_id, class
order by org_id, class;

-- Seduh ID backfill (T-ID.B4): UNDO a backfill that was COMMITTED. OWNER-RUN. Not a migration.
--
-- What it undoes: exactly what ONE committed run did, using the two lists that run printed in `applied`:
--   created_identity_ids   the identities that run created
--   linked_person_ids      the people that run linked
-- It never touches anything else: an identity that existed before the run (it was reused), a person linked by someone
-- else or by the link function later, an opted_out identity, a merge ledger row.
--
-- Steps, in one transaction: (1) unlink the listed people, but only those still linked to one of the listed identities
-- (a person since linked elsewhere is left alone); (2) delete a listed identity only if it is still `archive`/`active`
-- (not since opted out or merged), no person is linked to it any more and no tombstone points at it. An identity that
-- still has a person (linked later by the link function, which is legitimate) is KEPT and reported, not deleted.
-- Deleting an identity cannot be undone and the links it carried are gone with it: this is data loss on purpose.
--
-- Paste the two lists between the quotes below. With the defaults it changes nothing. It prints counts only, and ENDS IN
-- ROLLBACK: read the counts, then change the last line to COMMIT and run it again. Run as the database owner.

begin;
select set_config('app.seduh_link_write', 'on', true);

create temp table _undo_ids on commit drop as
select
  array(select jsonb_array_elements_text('[]'::jsonb))::uuid[] as identity_ids,  -- paste created_identity_ids inside the []
  array(select jsonb_array_elements_text('[]'::jsonb))::uuid[] as person_ids;    -- paste linked_person_ids inside the []

with unlinked as (
  update public.people p set global_person_id = null
   where p.id in (select unnest(person_ids) from _undo_ids)
     and p.global_person_id in (select unnest(identity_ids) from _undo_ids)
  returning p.id
),
deleted as (
  delete from app.seduh_identities i
   where i.id in (select unnest(identity_ids) from _undo_ids)
     and i.source = 'archive' and i.status = 'active'
     and not exists (select 1 from public.people p where p.global_person_id = i.id and p.id <> all (select id from unlinked))
     and not exists (select 1 from app.seduh_identities t where t.merged_into = i.id)
  returning i.id
)
select (select count(*) from unlinked) as people_unlinked,
       (select count(*) from deleted)  as identities_deleted,
       cardinality((select identity_ids from _undo_ids)) - (select count(*) from deleted) as identities_kept;

select set_config('app.seduh_link_write', '', true);

-- Change to COMMIT only after reading the counts above.
rollback;

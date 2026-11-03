-- Seduh Score Next · T-ID.D1b: the review queue's size in the operator's counts-only Seduh ID view
--
-- Why: with the archive feed (20261103100000_seduh_feed.sql) the operator needs to see that podiums are waiting for their
-- review without opening SQL. Same rule as T-ID.C3 (20261031110000): COUNTS ONLY, one row of integers, no id, no name, no
-- phone, no per-organisation figure. This adds four integers, the queue length by state:
--   feed_queued     published podiums waiting for the owner's review
--   feed_processed  reviewed and run (identities created or reused, people linked)
--   feed_rejected   reviewed and declined by the owner (owner SQL)
--   feed_undone     processed, then undone
-- The four add up to every queue row. The mode itself is not shown (it is a setting, not a count; the owner reads it with SQL).
--
-- A function's result columns cannot change under `create or replace`, so the function is dropped and created again with
-- the same body plus the four columns, the same gate as its FIRST statement (app.require_platform_admin(), pinned by test
-- 048 for every admin function), the same ACL (authenticated only; the gate decides). It writes no audit row, as before.
-- The console (src/admin/seduhIdPanel.js) shows the four in the same change; the e2e attack list and test 065 pin the
-- column list.
--
-- rollback: (restores the C3 shape of 20261031110000; pgTAP 071 runs this block in a transaction)
--   drop function if exists public.admin_seduh_id_counts();
--   create function public.admin_seduh_id_counts()
--   returns table (identities_total integer, identities_active integer, identities_opted_out integer, identities_merged integer,
--     identities_from_roster integer, identities_from_archive integer, identities_orphan integer, people_total integer,
--     people_linked integer, people_blocked integer)
--   language plpgsql stable security definer set search_path = '' as $$
--   #variable_conflict use_column
--   begin
--     perform app.require_platform_admin();
--     return query
--     select (select count(*)::integer from app.seduh_identities),
--            (select count(*)::integer from app.seduh_identities i where i.status = 'active'),
--            (select count(*)::integer from app.seduh_identities i where i.status = 'opted_out'),
--            (select count(*)::integer from app.seduh_identities i where i.status = 'merged'),
--            (select count(*)::integer from app.seduh_identities i where i.source = 'organiser_roster'),
--            (select count(*)::integer from app.seduh_identities i where i.source = 'archive'),
--            (select count(*)::integer from app.seduh_identities i
--              where i.status <> 'merged' and not exists (select 1 from public.people p where p.global_person_id = i.id)),
--            (select count(*)::integer from public.people),
--            (select count(*)::integer from public.people p where p.global_person_id is not null),
--            (select count(*)::integer from app.person_link_blocks b
--              join public.people p on p.id = b.person_id and p.phone = b.phone_e164);
--   end;
--   $$;
--   revoke all on function public.admin_seduh_id_counts() from public, anon, authenticated, service_role;
--   grant execute on function public.admin_seduh_id_counts() to authenticated;

drop function if exists public.admin_seduh_id_counts();

create function public.admin_seduh_id_counts()
returns table (
  identities_total       integer,
  identities_active      integer,
  identities_opted_out   integer,
  identities_merged      integer,
  identities_from_roster integer,
  identities_from_archive integer,
  identities_orphan      integer,
  people_total           integer,
  people_linked          integer,
  people_blocked         integer,
  feed_queued            integer,
  feed_processed         integer,
  feed_rejected          integer,
  feed_undone            integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform app.require_platform_admin();
  return query
  select (select count(*)::integer from app.seduh_identities),
         (select count(*)::integer from app.seduh_identities i where i.status = 'active'),
         (select count(*)::integer from app.seduh_identities i where i.status = 'opted_out'),
         (select count(*)::integer from app.seduh_identities i where i.status = 'merged'),
         (select count(*)::integer from app.seduh_identities i where i.source = 'organiser_roster'),
         (select count(*)::integer from app.seduh_identities i where i.source = 'archive'),
         (select count(*)::integer from app.seduh_identities i
           where i.status <> 'merged'
             and not exists (select 1 from public.people p where p.global_person_id = i.id)),
         (select count(*)::integer from public.people),
         (select count(*)::integer from public.people p where p.global_person_id is not null),
         (select count(*)::integer from app.person_link_blocks b
           join public.people p on p.id = b.person_id and p.phone = b.phone_e164),
         (select count(*)::integer from app.seduh_feed_queue q where q.state = 'queued'),
         (select count(*)::integer from app.seduh_feed_queue q where q.state = 'processed'),
         (select count(*)::integer from app.seduh_feed_queue q where q.state = 'rejected'),
         (select count(*)::integer from app.seduh_feed_queue q where q.state = 'undone');
end;
$$;

revoke all on function public.admin_seduh_id_counts() from public, anon, authenticated, service_role;
grant execute on function public.admin_seduh_id_counts() to authenticated;

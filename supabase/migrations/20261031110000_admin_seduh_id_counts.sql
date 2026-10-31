-- Seduh Score Next · T-ID.C3: the platform operator's counts-only view of Seduh ID
--
-- Why: the operator should be able to see how big the Seduh ID directory is and whether it is healthy, without the
-- console ever showing a person. Owner decision 7a (Handoffs and Specs/SEDUH-ID-LAYER1-SPEC-DRAFT.md 3.7): COUNTS ONLY.
-- No merge screen, no names, no phones, no ids, no lookup, no per-organisation breakdown (a per-organisation count could
-- identify who is in the directory). Merges and unlinks stay owner SQL (CONVENTIONS.md, Seduh ID runbook). D-A4 of
-- ADMIN-CONSOLE-SPEC stays as it is: an integer is metadata, a directory row is a person.
--
--   * admin_seduh_id_counts()   ONE row of integers, gated by app.require_platform_admin() as its FIRST statement (the
--                               same shape as admin_list_orgs, admin_list_keys: nothing runs before the gate, test 048
--                               pins that for every public.admin_* function). Columns:
--       identities_total, identities_active, identities_opted_out, identities_merged   (the three statuses add up)
--       identities_from_roster, identities_from_archive                                (the two sources add up)
--       people_total, people_linked (global_person_id is not null), people_blocked (a block that still applies:
--       app.person_link_blocks joined to the person on person_id AND phone_e164 = people.phone, the rule B4 and
--       link_person_identity use, so a block that lapsed after a phone change is not counted)
--       identities_orphan           an identity that is not a tombstone (status <> 'merged') and that no person links to:
--                                   the SAME definition as the orphan list in app.seduh_identity_backfill (B4), minus its
--                                   "the run would still link it" dry-run clause.
--
-- AUDIT: no audit row. app.admin_audit_log records CHANGES made through the console (org.create, member.add,
-- member.role_set, grant and key changes); every existing admin READ (admin_list_orgs, admin_org_detail, admin_list_audit,
-- admin_plan_orgs, admin_list_keys) writes none, and a read-only STABLE function cannot. A count returns no identity, so
-- there is nothing a log entry would protect. Refused calls write nothing either (the gate raises first).
--
-- The function is SECURITY DEFINER, STABLE, search_path pinned to '', revoked from public/anon/authenticated/service_role,
-- then granted to authenticated only (the gate decides), exactly as the other admin reads. It takes no argument, so guard
-- 041 (functions with a uuid argument) does not list it; guard 050 (the exact list of admin functions) does.
-- Call it with POST (supabase-js .rpc does), like the other admin reads.
--
-- rollback:
--   drop function if exists public.admin_seduh_id_counts();

create or replace function public.admin_seduh_id_counts()
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
  people_blocked         integer
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
           join public.people p on p.id = b.person_id and p.phone = b.phone_e164);
end;
$$;

revoke all on function public.admin_seduh_id_counts() from public, anon, authenticated, service_role;
grant execute on function public.admin_seduh_id_counts() to authenticated;

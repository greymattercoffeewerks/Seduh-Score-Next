-- Seduh Score Next · T-ADM.B2: the admin audit log (append-only)
--
-- Why: every change the admin console makes (create an org, attach a member, change a role, create a
-- login) must leave a record that the admin cannot edit or remove through the API (spec: Handoffs and
-- Specs/ADMIN-CONSOLE-SPEC.md, D-A6, D-A13, section 3.2). This migration adds the table and its writer;
-- the wrappers that call the writer arrive in later batches, and the log is read through an RPC
-- (admin_list_audit, a later batch, paging by id), never directly.
--
-- What this adds:
--   * app.admin_audit_log: one row per admin action. Like platform_admins it lives in the `app` schema
--     (not exposed by the API; not covered by the tenant-table guards), has RLS on with NO policies and
--     every API role's privileges revoked. There are deliberately NO foreign keys to orgs or auth.users,
--     so the history survives an org or a login being deleted. Ids have gaps (a refused insert still
--     consumes an id): a gap is NOT evidence of deletion.
--   * Append-only through the API and by accident: a BEFORE UPDATE OR DELETE row trigger and a BEFORE
--     TRUNCATE statement trigger (TRUNCATE fires no row trigger, so it needs its own) both call
--     app.forbid_admin_audit_mutation(), which raises 42501 for every role, the table owner included.
--     Same pattern as score_change_log (20260924100000). Both triggers are ENABLE ALWAYS, so they also
--     fire under `session_replication_role = replica`. The function is deliberately NOT security definer:
--     a definer trigger function must carry a membership gate or a 42501 refusal under guard 045, and
--     this one is a plain refusal.
--   * HONEST LIMIT (security and schema review): this is NOT tamper-proof against the table owner. The
--     owner is `postgres`, the role that migrations, the dashboard SQL editor and the MCP execute_sql
--     run as, and it is not a superuser here. As the owner, anyone can DISABLE or DROP the triggers,
--     CREATE OR REPLACE the trigger function as a no-op, rewrite rows with a DDL rewrite
--     (ALTER COLUMN ... TYPE ... USING), INSERT ... OVERRIDING SYSTEM VALUE with a forged id, actor or
--     time, add a BEFORE INSERT trigger that silently drops later rows, or DROP the table. There is no
--     hash chain and no external copy, so there is no tamper EVIDENCE either; score_change_log has the
--     same limit. The spec's position stands: SQL access as the operator is outside this guard (threat
--     model, item 2); the log defends against API roles, a stolen admin session and mistakes. There is
--     no retention policy and no purge path for anyone; a no-op action should not be logged (a later
--     batch), because an unpurgeable table that fills the disk can put the database into read-only mode.
--   * What a row may hold (D-A6, D-A13), enforced by CHECK constraints so no writer can get it wrong:
--       action  a stable dotted vocabulary string such as `org.create` or `member.role_set`, 60 chars max
--       detail  a JSON OBJECT, at most 4000 characters, whose KEY NAMES (at any depth, any case) contain
--               none of: pass, token, secret, email / e-mail, api key, jwt, otp, credential, phone
--               (app.admin_audit_detail_ok). Values are NOT inspected (an org name may legitimately look
--               like anything), and a homoglyph spelling of a key slips through: this is defence in depth
--               against a future writer's mistake, not a boundary. The real control is each wrapper's own
--               test pinning the exact key set it writes (slug, name, role, attested, from, to).
--   * app.admin_audit(action, org, user, detail): the writer for the admin wrappers. It requires a
--     platform admin at aal2 with a fresh TOTP ITSELF (app.require_platform_admin()), so a wrapper that
--     forgets the check cannot write; actor_id is always auth.uid(), never a parameter, so one admin can
--     never write a row in another's name. Not executable by any API role: only the definer wrappers
--     (later batches) and the owner reach it. The Edge Function's account.create row will use its own
--     service-role-only function (a later batch); test 047 pins the set of functions that mention the
--     table, so a stray writer fails CI.
--
-- Action vocabulary today: org.create, member.add, member.role_set, account.create. A new action is a new
-- string plus a test, never a schema change.
--
-- rollback: (this DESTROYS the audit history; do not roll back a log that holds real rows)
--   drop function if exists app.admin_audit(text, uuid, uuid, jsonb);
--   drop table if exists app.admin_audit_log;
--   drop function if exists app.admin_audit_detail_ok(jsonb);
--   drop function if exists app.forbid_admin_audit_mutation();

-- The detail check, as a function so it can be case-insensitive and recursive (a CHECK cannot run a
-- subquery). Matches a KEY: a quoted string followed by a colon, in jsonb's own text rendering.
create or replace function app.admin_audit_detail_ok(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(p_detail) = 'object'
     and p_detail::text !~* '"[^"]*(pass|token|secret|e-?mail|api_?key|jwt|otp|credential|phone)[^"]*"\s*:';
$$;

create table app.admin_audit_log (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor_id        uuid not null,
  action          text not null,
  target_org_id   uuid,
  target_user_id  uuid,
  detail          jsonb not null default '{}'::jsonb,
  constraint admin_audit_log_action_format
    check (action ~ '^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$' and char_length(action) <= 60),
  constraint admin_audit_log_detail_object
    check (jsonb_typeof(detail) = 'object'),
  constraint admin_audit_log_detail_size
    check (char_length(detail::text) <= 4000),
  constraint admin_audit_log_detail_no_secrets
    check (app.admin_audit_detail_ok(detail))
);

-- admin_list_audit pages by id (id < p_before, newest first), optionally for one org. The primary key
-- serves the unfiltered page; this serves the per-org one. (`at` is the TRANSACTION start time, so it can
-- run out of id order under concurrent writers; the id is the order.)
create index admin_audit_log_org_id_idx on app.admin_audit_log (target_org_id, id desc);

alter table app.admin_audit_log enable row level security;
revoke all on app.admin_audit_log from public, anon, authenticated, service_role;
revoke all on sequence app.admin_audit_log_id_seq from public, anon, authenticated, service_role;

create or replace function app.forbid_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'admin_audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger trg_admin_audit_log_no_update_delete
  before update or delete on app.admin_audit_log
  for each row execute function app.forbid_admin_audit_mutation();
create trigger trg_admin_audit_log_no_truncate
  before truncate on app.admin_audit_log
  for each statement execute function app.forbid_admin_audit_mutation();
-- ALWAYS: fire under session_replication_role = replica too (closes the cheapest bypass; the owner-level
-- ones in the limit above remain).
alter table app.admin_audit_log enable always trigger trg_admin_audit_log_no_update_delete;
alter table app.admin_audit_log enable always trigger trg_admin_audit_log_no_truncate;

create or replace function app.admin_audit(
  p_action text,
  p_org uuid default null,
  p_user uuid default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  insert into app.admin_audit_log (actor_id, action, target_org_id, target_user_id, detail)
  values (auth.uid(), p_action, p_org, p_user, coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke all on function app.admin_audit_detail_ok(jsonb) from public, anon, authenticated, service_role;
revoke all on function app.forbid_admin_audit_mutation() from public, anon, authenticated, service_role;
revoke all on function app.admin_audit(text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

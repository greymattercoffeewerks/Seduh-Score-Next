-- Seduh Score Next · the Seduh ID handle watch list (owner decision 2026-11-16)
--
-- Until now the handles nobody may claim were a fixed array inside app.seduh_handle_reserved, so every added word cost a
-- migration and a release. The owner wants a list they manage by SQL (later perhaps from the admin console) that also catches
-- impersonation (`admin`, `adm1n`, `seduh-0fficial`) and swear words, without turning away honest names. This migration moves
-- the list into a table and teaches the one function every caller already uses to read it.
--
-- FOUR KINDS, each with its own rule (term is matched against the handle):
--   system         the words the site itself needs (routes and infrastructure: claim, country, id, firdaus ...). EXACT match on the
--                  handle as typed. Today's whole array is seeded here, `firdaus` included (the owner's alias, worker/idRoute.js).
--   impersonation  blocked when the term appears ANYWHERE in the NORMALISED handle (admin, superuser, root, official, seduh ...).
--   profanity      each row says `exact` (the whole normalised handle equals the term) or `contains` (the term appears anywhere).
--                  Short or ambiguous words are exact-only, to avoid the Scunthorpe problem (Cassandra contains "ass", Assam is a
--                  tea). Only unmistakable words use `contains`. THE REAL WORDS ARE NOT IN THIS MIGRATION: the repository is
--                  public, so the owner loads them from a local file (CONVENTIONS.md, "Seduh ID handle watch list").
--   allow          exact handles the owner explicitly permits. It beats every block. It lives in the SAME table (one place to look,
--                  one loader, one unique key, one RLS posture) rather than a second one, and a guard trigger refuses an allow row
--                  that equals a `system` word (and the other way round): a route word or a reserved alias is never allowed by
--                  accident; to free one, delete the system row on purpose.
--
-- NORMALISING (app.seduh_handle_normalise, used for `impersonation` and `profanity` only): lower case; remove hyphens; map the
-- look-alikes 0->o 1->i 3->e 4->a 5->s 7->t 8->b @->a $->s. Repeated letters are tolerated by the TERM's pattern rather than by
-- collapsing both sides: each character of the normalised term becomes `c+` (app.seduh_handle_pattern), so `admiin` and `aaadmin` match
-- `admin`, while the term `root` (pattern r+o+o+t+) does not match `carrot` or `protein` (collapsing both sides to `rot` would).
-- The owner writes terms plainly; the term is normalised the same way as the handle.
--
-- ONE NEUTRAL ANSWER. app.seduh_handle_reserved still answers a boolean; public.seduh_handle_available still says `reserved` and
-- claim_seduh_id still raises the hint `handle_reserved`, whatever kind matched, so nobody can probe which category a word is in.
--
-- NEVER AUTOMATIC FOR EXISTING HANDLES. A handle is permanent; a later watch-list entry stops NEW claims only. The owner-only report
-- app.seduh_handle_blocklist_clashes() lists existing accounts the current list would block, for review; closing one is the
-- existing undo runbook (CONVENTIONS.md), a human decision.
--
-- WHY THIS IS PLATFORM DATA, NOT A TENANT TABLE: the list belongs to the platform (it constrains every organisation's people alike)
-- and has no org_id, event, stage, heat or match column, so there is nothing to scope, freeze or add to the cross-organisation
-- matrices (040, 041). It sits in `app` like the other platform tables: row-level security on, NO policy, every privilege revoked
-- from the API roles; only the owner role reads or writes it (050 pins the table set and checks both).
--
-- VOLATILITY. app.seduh_handle_reserved changes from IMMUTABLE to STABLE (it now reads a table). Every caller was checked: the
-- account `before insert` trigger (a plain function call), public.seduh_handle_available (already STABLE), public.claim_seduh_id,
-- the reclaim path and public.public_seduh_profile (all plpgsql/sql bodies). No index, constraint, generated column or default
-- uses it (an IMMUTABLE requirement would have failed the build), so nothing depends on it being immutable. It stays SECURITY
-- INVOKER like every other app helper (079 pins that): its callers are SECURITY DEFINER doors or the owner role, which can read
-- the owner-only table, and its execute grant stays revoked from every API role; an empty search_path keeps it closed.
--
-- rollback: restore the previous definition (the fixed list, `firdaus` included) and remove everything this migration added
--   create or replace function app.seduh_handle_reserved(p_handle text)
--   returns boolean
--   language sql
--   immutable
--   set search_path = ''
--   as $fn$
--     select p_handle = any (array[
--       'about', 'admin', 'api', 'app', 'assets', 'bts', 'claim', 'community', 'contact', 'country', 'countries',
--       'edit', 'event', 'events', 'favicon', 'firdaus', 'guess-the-bean', 'help', 'id', 'index', 'live', 'login', 'logout', 'me',
--       'moderator', 'new', 'null', 'official', 'org', 'orgs', 'owner', 'pricing', 'privacy', 'public', 'results', 'robots',
--       'root', 'score', 'security', 'seduh', 'seduh-score', 'seduhscore', 'staff', 'settings', 'signin', 'signup', 'sitemap', 'static', 'support', 'team', 'teams', 'terms', 'tools',
--       'tour', 'undefined', 'www'
--     ]);
--   $fn$;
--   revoke all on function app.seduh_handle_reserved(text) from public, anon, authenticated, service_role;
--   drop function if exists app.seduh_handle_blocklist_clashes();
--   drop function if exists app.seduh_handle_blocked_by(text);
--   drop table if exists app.seduh_handle_blocklist;
--   drop function if exists app.seduh_handle_blocklist_guard();
--   drop function if exists app.seduh_handle_pattern(text);
--   drop function if exists app.seduh_handle_normalise(text);
-- (The table's rows are lost, including any profanity the owner loaded; keep the local CSV. A handle claimed while the table
-- stood is unaffected, handles being permanent.)

-- ============ the normaliser ============

create function app.seduh_handle_normalise(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(replace(lower(coalesce(p_text, '')), '-', ''), '0134578@$', 'oieastbas');
$$;
revoke all on function app.seduh_handle_normalise(text) from public, anon, authenticated, service_role;

-- the regular expression a term stands for: its normalised characters, each allowed to repeat (admin -> a+d+m+i+n+).
-- Terms are plain [a-z0-9] by the table's check, so the result holds no regex syntax but the plus signs.
create function app.seduh_handle_pattern(p_term text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(app.seduh_handle_normalise(p_term), '([a-z0-9])', '\1+', 'g');
$$;
revoke all on function app.seduh_handle_pattern(text) from public, anon, authenticated, service_role;

-- ============ the table ============

create table app.seduh_handle_blocklist (
  term        text not null,
  kind        text not null,
  match_mode  text not null,
  note        text,
  created_at  timestamptz not null default now(),
  constraint seduh_handle_blocklist_pkey primary key (term, kind),
  constraint seduh_handle_blocklist_kind_vocab check (kind in ('system', 'impersonation', 'profanity', 'allow')),
  constraint seduh_handle_blocklist_mode_vocab check (match_mode in ('exact', 'contains')),
  -- system and allow are always exact; impersonation is always contains; profanity chooses
  constraint seduh_handle_blocklist_kind_mode check (
    (kind in ('system', 'allow') and match_mode = 'exact')
    or (kind = 'impersonation' and match_mode = 'contains')
    or kind = 'profanity'),
  -- system: a handle-shaped route word (2 to 30, single hyphens). allow: a claimable handle (3 to 30, same shape).
  -- impersonation and profanity: plain lowercase letters and digits, 3 to 30, and 4 or more to be used as `contains`.
  constraint seduh_handle_blocklist_term_shape check (
    case kind
      when 'system' then term ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(term) between 2 and 30
      when 'allow' then term ~ '^[a-z0-9](-?[a-z0-9])*$' and char_length(term) between 3 and 30
      else term ~ '^[a-z0-9]+$' and char_length(term) between 3 and 30
           and (match_mode = 'exact' or char_length(term) >= 4)
    end),
  constraint seduh_handle_blocklist_note_length check (note is null or char_length(note) <= 200)
);
alter table app.seduh_handle_blocklist enable row level security;
revoke all on table app.seduh_handle_blocklist from public, anon, authenticated, service_role;

-- an allow row may not equal a system word (and a system row may not equal an allow row)
create function app.seduh_handle_blocklist_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind in ('system', 'allow') and exists (
       select 1 from app.seduh_handle_blocklist b
        where b.term = new.term and b.kind = case new.kind when 'system' then 'allow' else 'system' end) then
    raise exception 'seduh_handle_blocklist: % is both a system word and on the allow list (delete one on purpose)', new.term
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.seduh_handle_blocklist_guard() from public, anon, authenticated, service_role;
create trigger trg_seduh_handle_blocklist_guard
  before insert or update on app.seduh_handle_blocklist
  for each row execute function app.seduh_handle_blocklist_guard();

-- ============ the one rule: which rows block a handle ============

create function app.seduh_handle_blocked_by(p_handle text)
returns table (term text, kind text, match_mode text)
language sql
stable
set search_path = ''
as $$
  select b.term, b.kind, b.match_mode
    from app.seduh_handle_blocklist b
   where b.kind <> 'allow'
     and not exists (select 1 from app.seduh_handle_blocklist a where a.kind = 'allow' and a.term = lower(coalesce(p_handle, '')))
     and case
           when b.kind = 'system' then b.term = lower(coalesce(p_handle, ''))
           when b.match_mode = 'exact' then app.seduh_handle_normalise(p_handle) ~ ('^' || app.seduh_handle_pattern(b.term) || '$')
           else app.seduh_handle_normalise(p_handle) ~ app.seduh_handle_pattern(b.term)
         end;
$$;
revoke all on function app.seduh_handle_blocked_by(text) from public, anon, authenticated, service_role;

create or replace function app.seduh_handle_reserved(p_handle text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from app.seduh_handle_blocked_by(p_handle));
$$;
revoke all on function app.seduh_handle_reserved(text) from public, anon, authenticated, service_role;

-- ============ the report: existing handles the CURRENT list would block (owner SQL, read only) ============

create function app.seduh_handle_blocklist_clashes()
returns table (handle text, founding_number integer, closed boolean, matched_term text, matched_kind text, matched_mode text)
language sql
stable
set search_path = ''
as $$
  select a.handle, a.founding_number, a.closed_at is not null, m.term, m.kind, m.match_mode
    from app.seduh_accounts a
   cross join lateral app.seduh_handle_blocked_by(a.handle) m
   order by a.founding_number, m.kind, m.term;
$$;
revoke all on function app.seduh_handle_blocklist_clashes() from public, anon, authenticated, service_role;

-- ============ seeds: today's array (system), then the impersonation set ============

insert into app.seduh_handle_blocklist (term, kind, match_mode, note)
select w, 'system', 'exact', 'migrated from the fixed array (20261115120000, 20261120100000)'
  from unnest(array[
    'about', 'admin', 'api', 'app', 'assets', 'bts', 'claim', 'community', 'contact', 'country', 'countries',
    'edit', 'event', 'events', 'favicon', 'firdaus', 'guess-the-bean', 'help', 'id', 'index', 'live', 'login', 'logout', 'me',
    'moderator', 'new', 'null', 'official', 'org', 'orgs', 'owner', 'pricing', 'privacy', 'public', 'results', 'robots',
    'root', 'score', 'security', 'seduh', 'seduh-score', 'seduhscore', 'staff', 'settings', 'signin', 'signup', 'sitemap', 'static', 'support', 'team', 'teams', 'terms', 'tools',
    'tour', 'undefined', 'www'
  ]) w;

insert into app.seduh_handle_blocklist (term, kind, match_mode, note)
select w, 'impersonation', 'contains', 'passing for the platform or its staff'
  from unnest(array[
    'admin', 'superuser', 'sysadmin', 'root', 'official', 'seduh', 'seduhscore', 'support', 'staff', 'moderator',
    'owner', 'security', 'help', 'webmaster', 'postmaster'
  ]) w;

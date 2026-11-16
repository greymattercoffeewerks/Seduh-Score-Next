-- Seduh Score Next · reserve the Seduh ID handle `firdaus` (owner decision 2026-11-16)
--
-- The owner (Seduh ID #0001) is claiming the handle `mfosa` and wants their first name to be theirs for ever: no other person
-- may claim `firdaus`, and /id/firdaus redirects to /id/mfosa (worker/idRoute.js, HANDLE_ALIASES; every alias must also be
-- reserved here, which tools/seduh-handle-aliases.test.js checks).
--
-- Only the reserved list changes: the same function (signature, immutable, empty search_path, revoke) with 'firdaus' added.
-- Existing handles are not rechecked (a handle is frozen; a later reservation stops NEW claims only). No account holds
-- `firdaus` today: the cloud has 0 accounts (the owner is claiming `mfosa`), so nothing is left with a reserved handle.
--
-- rollback: restore the previous definition (the list without 'firdaus'):
--   create or replace function app.seduh_handle_reserved(p_handle text)
--   returns boolean
--   language sql
--   immutable
--   set search_path = ''
--   as $fn$
--     select p_handle = any (array[
--       'about', 'admin', 'api', 'app', 'assets', 'bts', 'claim', 'community', 'contact', 'country', 'countries',
--       'edit', 'event', 'events', 'favicon', 'guess-the-bean', 'help', 'id', 'index', 'live', 'login', 'logout', 'me',
--       'moderator', 'new', 'null', 'official', 'org', 'orgs', 'owner', 'pricing', 'privacy', 'public', 'results', 'robots',
--       'root', 'score', 'security', 'seduh', 'seduh-score', 'seduhscore', 'staff', 'settings', 'signin', 'signup', 'sitemap', 'static', 'support', 'team', 'teams', 'terms', 'tools',
--       'tour', 'undefined', 'www'
--     ]);
--   $fn$;
--   revoke all on function app.seduh_handle_reserved(text) from public, anon, authenticated, service_role;
-- (A handle that was claimed as `firdaus` while this stood could not be un-claimed by the rollback; there is none.)

create or replace function app.seduh_handle_reserved(p_handle text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_handle = any (array[
    'about', 'admin', 'api', 'app', 'assets', 'bts', 'claim', 'community', 'contact', 'country', 'countries',
    'edit', 'event', 'events', 'favicon', 'firdaus', 'guess-the-bean', 'help', 'id', 'index', 'live', 'login', 'logout', 'me',
    'moderator', 'new', 'null', 'official', 'org', 'orgs', 'owner', 'pricing', 'privacy', 'public', 'results', 'robots',
    'root', 'score', 'security', 'seduh', 'seduh-score', 'seduhscore', 'staff', 'settings', 'signin', 'signup', 'sitemap', 'static', 'support', 'team', 'teams', 'terms', 'tools',
    'tour', 'undefined', 'www'
  ]);
$$;
revoke all on function app.seduh_handle_reserved(text) from public, anon, authenticated, service_role;

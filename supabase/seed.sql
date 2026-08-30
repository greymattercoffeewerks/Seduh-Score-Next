-- Seduh Score Next · Local dev seed
--
-- Applied by `supabase db reset` (and by a fresh `supabase start`) per
-- config.toml's [db.seed] block. A bare `supabase db push` never touches
-- seed files, and no script or CI job in this repo runs anything that
-- would — but this is a procedural guarantee, not an automatic one:
-- `supabase db push --include-seed` and `supabase db reset --linked`
-- (default: seeds unless passed `--no-seed`) WOULD apply this file to a
-- linked project, creating this exact login there. No cloud project is
-- linked yet (see CLAUDE.md); once one is, never run either of those two
-- forms against it.
--
-- Exists to close a real gap found during the 2026-08-29 app-wiring pass:
-- every organiser-facing table is granted to `authenticated` only, not
-- `anon` (see 20260821240000_grants.sql), and this project deliberately
-- has no login screen yet (D-scoped: "no real login needed yet" — see
-- core/config.js's own comment). Without a seeded org + a real
-- auth.users row already a member of it, there is no way to exercise the
-- real app against the real local stack at all — not for a human
-- developer clicking through it, and not for an e2e test — short of
-- hand-crafting a user via curl every time. A fixed, well-known local-dev
-- login is the standard Supabase idiom for exactly this gap.
--
-- Credentials are intentionally public (this file is committed): local
-- dev and CI-only, never valid against a real deployed project since
-- seed.sql never reaches one.
--
-- Real, low-numbered UUIDs (genuine random UUIDs, not the readable
-- 00000000-0000-0000-0000-0000000000NN pattern the pgTAP fixtures under
-- supabase/tests/ use) — found the hard way in CI: `supabase test db`
-- runs a real `db reset` first, which applies this seed BEFORE the pgTAP
-- suite runs, and 001_core_tables.sql's own `orgs` fixture hardcodes
-- '...0001' as its own org id. The first version of this file used that
-- same id and broke the whole pgTAP suite with a duplicate-key error the
-- moment it ran in CI (never surfaced locally, since a local `db reset`
-- run for THIS file alone doesn't also run the pgTAP suite in the same
-- breath). Deliberately not reusing the fixtures' own low-number
-- convention going forward, for exactly this reason.
insert into orgs (id, name, slug)
values ('10c8c375-afe6-41c7-a54e-ffaa15429612', 'Local Dev Org', 'local-dev-org')
on conflict (id) do nothing;

-- confirmation_token/recovery_token/email_change_token_new/email_change
-- have no column default (NULL unless set) but GoTrue's own row-scan
-- expects a string, never NULL, for these — every column GoTrue itself
-- writes on signup (empty string, not NULL). Confirmed by reproducing the
-- failure locally, twice — signing in against a seeded row that left any
-- of these four NULL, GoTrue returned 500 "Database error querying
-- schema", and its own container log named the exact column each time
-- (e.g. "sql: Scan error on column index 8, name \"email_change\":
-- converting NULL to string is unsupported").
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  'f507f696-7495-40b5-ade7-138dd617807c',
  'authenticated',
  'authenticated',
  'organiser@local.test',
  extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
  now(),
  now(),
  now(),
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  false
)
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
)
values (
  gen_random_uuid(),
  'f507f696-7495-40b5-ade7-138dd617807c',
  'f507f696-7495-40b5-ade7-138dd617807c',
  'email',
  jsonb_build_object('sub', 'f507f696-7495-40b5-ade7-138dd617807c', 'email', 'organiser@local.test'),
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

insert into org_members (org_id, user_id, role)
values (
  '10c8c375-afe6-41c7-a54e-ffaa15429612',
  'f507f696-7495-40b5-ade7-138dd617807c',
  'organiser'
)
on conflict (org_id, user_id) do nothing;

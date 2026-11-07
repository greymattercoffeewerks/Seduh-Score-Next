# Admin console: operator runbooks and rollout record

Moved verbatim out of the root `CLAUDE.md` ("Platform administration"); nothing edited. The rules that must hold in every
session (the gate is the database's, metadata only, the only way to add an admin) stay in `CLAUDE.md`.

- **Add the first or another admin (the only way: no API, migration or seed makes one).** As the database owner (the
  Supabase MCP's `execute_sql` or the SQL editor), in this order, so the window in which a password alone is enough is
  as short as possible: (a) set a temporary random password on the person's login with the service key
  (`PUT /auth/v1/admin/users/<id>` with `{ "password": ... }`; the old one stops working) or, from the Supabase MCP
  (which holds no service key), `update auth.users set encrypted_password = extensions.crypt('<temp>',
extensions.gen_salt('bf', 10)) where id = '<id>'` (the same bcrypt hash, and `encrypted_password =
extensions.crypt('<temp>', encrypted_password)` proves it took; check first that the login has no live session and
  no factor); (b)
  `insert into app.platform_admins (user_id, note) values ('<auth.users.id>', '<who, why, when>');`; (c) they sign in
  at `/admin/` with the temporary password and **enrol their authenticator app at once**; (d) **replace the temporary password at once through the console's "Change password" panel** (`#/password`, needs
  the `aal2` session they just reached; asks for the current password, minimum 12 characters, ends their other
  sessions); make it long and random and keep it in a password manager. **Do NOT use the dashboard's "send a password
  recovery email" for an admin with an authenticator:** that link signs in at `aal1`, GoTrue refuses a password change
  from a password-only session once a factor is verified (`insufficient_aal`), and the link lands on a page with
  nothing listening. Rotation by someone else is by the Auth admin API with the service key or by SQL (step a), which
  leaves the value known to the operator's tooling, so follow it with the panel and then "Sign out everywhere". **If their first sign-in shows a CHALLENGE screen instead of the enrolment screen,
  someone else has already enrolled a factor: the account is compromised.** Delete that factor in the dashboard,
  rotate the password and start again. Until a factor is verified, anyone holding only the password could enrol
  their own. To remove an admin: `delete from app.platform_admins where user_id = '<id>';` cuts a live session off on
  its next call. Never reset an admin's password through the organiser Team screen (it refuses admins): use the Auth
  admin API.
- **Lost or stolen authenticator or session (the order matters).** (1) End every session of the login first: a
  global sign-out through the Auth admin API (`POST /auth/v1/logout?scope=global` with a token, or the console's
  "Sign out everywhere"), or a password reset (which deletes sessions). A ban only PAUSES the admin functions; it does
  not end sessions, so lift it only after step 3. (2) Remove the factor in the dashboard (Authentication, Users).
  (3) Enrol again yourself immediately. Reversed, a thief holding the old session is offered the enrolment screen the
  moment the factor goes. Provisioning by the SQL runbook below keeps working throughout. While the console is open
  it asks the database again whenever the tab becomes visible and every five minutes, so a revoked admin loses the
  screen without a reload.
- **TOTP is switched on for the whole project, so:** any signed-in user can enrol a factor on their own account;
  a person with a verified factor cannot change their password from a password-only session (`insufficient_aal`);
  and whoever knows a NEW login's one-time password could enrol a factor first and block the real owner's forced
  password change. The blast radius is small (the creator is already trusted) and it is a ROADMAP open item.
- **Known limits, accepted** (threat model, spec section 7): a stolen admin session is bounded by the 60-minute
  window and "Sign out everywhere", not prevented; `account.create` is two transactions, so a crash can leave an
  **orphan login** that nobody can sign in to (no function returns its password), belongs to no organisation and
  has no audit row: it blocks that email (a retry answers "already has an account") until the operator resets its
  password or removes it, and `admin_find_user` finds it (the console words these cases `account_state_unknown`,
  `account_record_failed` and `account_stranded`); refused calls write no audit row; audit ids have gaps that do not
  mean deletion; an admin who attaches someone to an organisation has given them its data.
- **Tests that hold this.** pgTAP `046` to `051` (identity, audit, read and write RPCs, the platform-tables
  contract, the audit writer); Playwright `dev-admin` (the console, plus `admin-console-adversarial.spec.js`: the
  attack list over HTTP, which a new admin function or door must be added to); and, for the Edge Function (not
  served in CI), `supabase/tests/manual/admin-accounts-e2e.mjs`, to run before every rollout.
- **Rollout status (2026-10-17): in the cloud and live (v3.4.0).** Done in order on 2026-10-16/17, each by the owner's
  approval: (1) the pre-checks (the exposed schemas exclude `app`, `pg_graphql` is off, `pg_default_acl` has no `app`
  entry, `postgres` can read `auth.sessions`); (2) the six migrations pushed with the Supabase MCP (cloud versions
  `20261016080210` to `20261016080352`, compared with `list_migrations`; advisors showed only the expected findings:
  `rls_enabled_no_policy` on the two `app` tables, lint 0029 on the admin functions, one unused index); (3) TOTP: the
  hosted dashboard had no switch to flip (Supabase documents TOTP as on by default), an organiser still signed in, and
  it was proven at the first enrolment (step 6); (4) `admin-accounts` deployed (version 1, `verify_jwt` true; the manual
  script had passed 35 of 35 against local first; probes: no auth 401, anon-key bearer 401, GET 405); (5) release PR
  #285 merged and `/admin/` checked live: 200, `no-store`, `X-Robots-Tag: noindex, nofollow`, the CSP with `connect-src
'self' https://*.supabase.co`, the meta robots tag, `/admin` redirecting to `/admin/`, and no link from `/`, `/app/`,
  `/tour/`, `/community/`, the sitemap or `robots.txt`; (6) the first admin, by the temporary-password procedure above,
  with the authenticator factor verified and one `aal2` session; (7) a smoke test on a throwaway organisation
  `console-smoke`, removed afterwards by SQL (the organisation, then the login a Team-screen add had made; the audit rows
  stay, by design).
  **Every console write path has now run against the cloud.** The first smoke test (2026-10-17) proved `org.create`
  with an existing account and `member.role_set` twice (an owner swapped between two accounts, which keeps one owner
  throughout, so `last_owner` never fired). On 2026-10-22 the owner proved the rest with throwaway organisations
  "Noice Test" and "Noice 2 Test": `account.create` with a NEW login (audit rows 4 and 5), `member.role_set` again
  (rows 6 and 7), `org.create` with an existing account and the attestation ticked (row 8) and `member.add` of an
  account whose one-time password was still unset, attestation ticked (row 9, `attested: true`). The two throwaway
  organisations and their two logins were then removed by SQL the same day (with the owner's old "Grey Matter
  Rehearsal" organisation, which held no events); the audit rows stay, by design.
  **The console cannot disable or delete anything**
  (organisation, member or login): a throwaway is removed by SQL, and a requested admin function for it is logged in
  ROADMAP.md ("Admin console: disable or delete", 2026-10-22).

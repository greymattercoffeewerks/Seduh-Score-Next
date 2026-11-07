# Provisioning an organisation, and build variables

Moved verbatim out of the root `CLAUDE.md` ("Repo"); nothing edited. The one-line rules stay in `CLAUDE.md`.

**Provisioning an org (T-TEN.B4; invite-only — there is no signup and no API role can do this).**
**The admin console is live in the cloud (rolled out 2026-10-17, see "Platform administration"), so `/admin/` is
the normal path and this SQL is the fallback** (the console's New organisation screen is `create_org` plus an audit
row and the same refusals, plus the admin gate, `admin_self_target` and `member_password_unset`). Whenever the console cannot be used (a lost authenticator, for example), run these
as the service role (the Supabase MCP's `execute_sql`), never from the app:

1. Make sure the owner has an account (Auth → Add user in the dashboard) and that **they set their
   own password**. Note their user id.
2. `select public.create_org('Display Name', 'url-slug', '<owner user id>');` returns the new org's id.
   The slug is trimmed and lower-cased, 3 to 40 letters/digits with single hyphens, not a reserved word
   (`app`, `admin`, `api`, `www`, `live`, `results`, `tour`, `community`, `tools`, `guess-the-bean`,
   `about`, `contact`, `privacy`, `terms`, `neutrality`, `login`, `signup`, `auth`, `assets`, `bts`,
   `marketing`, `events`, `team`, `projector`, `phone`, `splash`, `help`, `docs`, `support`, `pricing`,
   `status`, `static`, `settings`, `dashboard`) and not taken. **A slug can never be changed** (it is in
   printed and QR audience links) and deleting an org frees it for reuse, so choose with care.
3. To give an existing account a second membership (a two-org user):
   `select public.org_add_existing_member('<org id>', '<user id>', 'organiser');`. Only attach an account
   whose holder has set their own password, never one a Team screen created with a one-time password
   (that org's owner still knows it).
4. Refusals carry a stable `hint` (`org_slug_taken`, `org_slug_invalid`, `org_slug_reserved`,
   `org_name_invalid`, `org_owner_not_found`, `member_exists`, ...): read the hint, not the text.
5. To make someone else owner or demote an owner use `select public.org_set_role(...)` (B5); an org can
   never be left without an owner.

**Build variables (Cloudflare Workers Builds → Settings → Build → Variables and secrets).** Three, all `VITE_`:
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_LEGACY_AUDIENCE_ORG_SLUG=grey-matter-coffee-werks` (the one
organisation the old slug-less audience links mean; retire it, and the shim in `src/core/config.js`, when those
printed links are gone). `VITE_DEFAULT_ORG_ID` was **removed on 2026-10-13** (T-TEN.E5 step 6) and must not come back:
the organiser console takes its organisation from the signed-in person's memberships, and an unset variable never
throws. A change to these variables takes effect only on the NEXT production build (retry the latest build on
`main`). **Preview builds (pull request branches) do not receive them at all**, so a preview shows "supabaseUrl is
required" whatever the dashboard says; only a production build tells you anything. Check a production change by
fetching `/app/`, then its `app-*.js`, and looking for the Supabase project ref and the slug; keep the previous
deployment (Deployments → Rollback) one click away until you have.

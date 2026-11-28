# Running the e2e suite locally (Windows)

CI runs `Playwright e2e` only on PRs into `main`. For a feature PR into `dev`, run it on your own PC first and put the
result in the PR's Testing section. Threads that run on the PC do the same before they report a PR ready.

## Steps

1. Start **Docker Desktop** and wait until it says it is running.
2. In PowerShell, from the repo folder (`C:\Dev\seduh-score-next`):

   ```powershell
   npm install                       # only when package.json changed
   npm run supabase -- start         # skip if already running
   npm run db:reset                  # fresh migrations + seed
   npm run db:lock -- run -- npm run test:e2e
   ```

3. Read the summary. All green means it is ready to merge into `dev`. Re-run only a failing spec with
   `npm run db:lock -- run -- npx playwright test tests/e2e/<file>.spec.js`.

## From a git worktree (a PR branch)

A fresh worktree has no `.env` (it is gitignored) and no `dist/`. Without them the first run fails with "supabaseUrl is
required" and "The directory dist does not exist". In the worktree, in Git Bash (PowerShell: set the same variables with
`$env:NAME = ...`):

```bash
npm ci
eval "$(npm run --silent supabase -- status -o env | grep -E '^(API_URL|ANON_KEY)=')"
export VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" VITE_LEGACY_AUDIENCE_ORG_SLUG=local-dev-org
npm run build                       # the built-app project serves dist/
npm run db:lock -- run -- npx playwright test --max-failures=0
```

`local-dev-org` is the seed organisation's slug (`supabase/seed.sql`). `--max-failures=0` keeps one failure from skipping the
rest. These are the local stack's own keys, not secrets; never put a real production key in a shell for a test run.

## If the Seduh ID specs fail

The `dev-identity` specs (claim link, photo upload) fail together when the local stack is unhealthy. Check before you
blame the branch:

- **`seduh-claim-*` fails with 503 on `/functions/v1/seduh-claim`:** the Edge Function container is not running.
  `docker ps -a` shows `supabase_edge_runtime_seduh-score-next` as `Exited`.
- **`seduh-photo-live` fails with a Storage 500, "code 42P10":** the database's Storage tables do not match the running
  Storage container (seen 2026-11-28 on a stack carrying Storage tables from a newer version).
- **The first request fails with "JWT issued at future" (seen once, 2026-11-28, right after a restart):** the Docker clock
  was ahead of the PC's clock. Compare `date -u` with `docker exec supabase_db_seduh-score-next date -u`; if they differ,
  restart Docker Desktop. It did not come back on a re-run.

For the first two, restart the stack and re-run (this briefly takes the shared database away from other sessions, so
check `npm run db:lock -- status` first):

```powershell
npm run supabase -- stop
npm run supabase -- start
npm run db:reset
```

Tests in a project stop running when a project they depend on fails ("N did not run"), so fix these first: a red
`dev-identity` hides about 43 other specs.

## Notes

- The lock makes parallel sessions queue instead of overwriting the shared local database. `npm run db:lock -- status`
  shows who holds it.
- First run on a new machine: `npx playwright install chromium`.
- The `dev-*` projects need the local stack and the seed; `built-app` and `dev-harnesses` do not.
- Never point `supabase db reset` at a URL on `127.0.0.1:54422` (see `CLAUDE.md`, "Git").

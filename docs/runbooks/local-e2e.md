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

## Notes

- The lock makes parallel sessions queue instead of overwriting the shared local database. `npm run db:lock -- status`
  shows who holds it.
- First run on a new machine: `npx playwright install chromium`.
- The `dev-*` projects need the local stack and the seed; `built-app` and `dev-harnesses` do not.
- Never point `supabase db reset` at a URL on `127.0.0.1:54422` (see `CLAUDE.md`, "Git").

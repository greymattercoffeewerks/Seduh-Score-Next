-- Guess the Bean — close a default-privilege gap CI caught, local dev didn't
-- Found by CI's "Migrations from scratch + pgTAP" job on a truly fresh
-- database: `has_table_privilege('anon', 'guesses', 'update')` (and 'delete',
-- and the same two for 'authenticated' and for `contacts`) returned true,
-- even though no Guess the Bean migration ever explicitly grants UPDATE or
-- DELETE on either table — the spec's own RLS checklist locks both to
-- "never, for anyone except service role." This is the exact same
-- `auto_expose_new_tables`-driven default-privilege class already documented
-- in 20260914121000_guess_the_bean_rls.sql's own comment for `sessions`
-- (a column grant, there) — `anon`/`authenticated` can hold a broad
-- table-level grant on a freshly created table purely from local/CI
-- environment defaults, independent of anything a migration explicitly
-- grants. `sessions` was defended against this; `guesses`/`contacts` never
-- were, because their own SELECT/INSERT grants were additive-looking enough
-- to not raise the same flag during review. A local, long-lived dev
-- database's role privileges don't reset the same way a truly fresh `db
-- reset`/CI run does, which is why this passed locally and only failed in
-- CI — environment-independence is exactly why the revoke-first pattern is
-- required, not optional, per that same migration's own comment.
--
-- rollback:
--   grant update, delete on guesses to anon, authenticated;
--   grant update, delete on contacts to anon, authenticated;

revoke update, delete on guesses from anon, authenticated;
revoke update, delete on contacts from anon, authenticated;

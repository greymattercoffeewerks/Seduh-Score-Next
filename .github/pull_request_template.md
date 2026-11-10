## Summary

What changes, and why.

## Version (release PRs into `main` only)

The version this ships and which part moved: major (new format or relaunch), minor (a new capability someone can use)
or patch (fixes, polish, groundwork). If any change since the last release is a new capability, it is at least a
minor. See `docs/versioning.md`.

## Testing

What you ran and what it showed (commands and results, or screenshots). Name the negative cases.

## Risk

What could go wrong, and which layer would catch it. Say if this touches RLS, an RPC, a migration, the admin console, the outbox, scoring, or a CI workflow.

## How to revert

How to undo it. For a migration: has it been pushed to the cloud project (merging does not push it), and what is the rollback?

## Reviews

Which reviewers ran and how each finding ended (fixed, wrong, intentional, did not matter).

# src/formats/bbtc/ — BBTC format

**Not started.** Placeholder so a directory-scoped `CLAUDE.md` exists from this format's
first commit, rather than being retrofitted later.

Root non-negotiables apply here unconditionally — see
[the repo root CLAUDE.md](../../../CLAUDE.md) for the full list, especially the module
boundary: this directory may import from `src/core/`, never the reverse. Read
[src/formats/cup-taster/CLAUDE.md](../cup-taster/CLAUDE.md) first as the worked example
of what a format module actually looks like once built.

Before writing the first line of code here: check whether the thing you're about to
build already exists as a `core/` primitive (ranking, advancement, timeclamp, outbox,
viewer-shell, router, appShell, etc.) — reuse it unedited. If it _almost_ fits but not
quite, that's a signal to widen the `core/` primitive (with `module-boundary-checker`
sign-off) rather than fork a second implementation the way v4.x forked its timer.

## Module history

_(empty — fill in as work starts, following the shape of
[src/formats/cup-taster/CLAUDE.md](../cup-taster/CLAUDE.md)'s "Module history" section)_

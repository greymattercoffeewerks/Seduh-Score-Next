// Nameplate versioning (CONVENTIONS.md "Versioning", D27). D27 deferred semver until
// "a first real shipped artifact" existed to number — that's now true (production on
// Cloudflare Workers Static Assets, per CLAUDE.md's Repo section), so this activates
// D27's own stated trigger rather than reversing it.
//
// Each build cycle takes a place name spiralling outward from Kiulap, mirroring the
// legacy Seduh Score site's own nameplate convention (see seduhscore.com/bts/) — but
// this is a SEPARATE, fresh spiral starting back at the urban core, not a continuation
// of that site's already-completed Kiulap-through-Seria run: this codebase is a
// from-scratch rewrite (Supabase, offline-first outbox, fixed advancement), not a
// patch on the same one. User decision, 2026-09-05.
//
// APP_VERSION is sourced from package.json (single writer) rather than duplicated here.
// Bumped on every closed task per CHANGELOG.md's own granularity, so the footer always
// names the exact deployed commit for quick, glance-based bug-report verification —
// that's this module's whole reason to exist.
import pkg from '../../package.json';

export const APP_VERSION = pkg.version;
export const NAMEPLATE = 'Kiulap';

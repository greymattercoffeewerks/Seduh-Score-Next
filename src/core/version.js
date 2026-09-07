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
// Bumped automatically per task close (kb-sync's own end-of-task step); a MAJOR bump
// (this one, 1.x -> 2.0.0) additionally moves NAMEPLATE to the next point in the spiral
// — reserved for a genuine capability-era boundary (a new format shipping, or a major
// cross-cutting relaunch), not a fixed schedule. See ROADMAP.md's "Version cycle plan"
// for the planned sequence and CONVENTIONS.md's "Versioning" for the full rule.
//
// Kiulap -> Berakas, 2026-09-07: the public marketing landing page (src/marketing/) —
// this cycle's own front door, moving the console to /app/ the same way legacy's own
// Berakas cycle was "the front door — seduhscore.com, an organiser zone... quietly
// turning a personal tool into something a stranger could actually sign into." Jumped
// the queue ahead of the originally-planned v2.0/Gadong (Throwdown) since it shipped
// first — see ROADMAP.md for the reordering.
import pkg from '../../package.json';

export const APP_VERSION = pkg.version;
export const NAMEPLATE = 'Berakas';

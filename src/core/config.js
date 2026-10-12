// Build-time settings. Deliberately separate from supabaseClient.js (that file's whole job is
// constructing the client, nothing about org selection).
//
// Which org the ORGANISER console works in is no longer a build-time setting: it comes from the
// signed-in person's memberships (core/orgContext.js, T-TEN.C1/C2). What remains is the anonymous
// audience screens, which have no signed-in person to ask. Their links now name the organiser
// (#/live/<slug>/projector, T-TEN.D1). The OLD slug-less links (#/live/projector, #/live/phone,
// #/live/splash) are printed and bookmarked and open on venue displays, so they keep working through a
// legacy shim: they show the one organisation named by `VITE_LEGACY_AUDIENCE_ORG_SLUG`, and while that is
// not set yet, the one named by the older `VITE_DEFAULT_ORG_ID`. Deploying the slug links cannot break an
// open display whichever order the dashboard variables are added in. When the shim is retired both
// variables go, together.
//
// Unlike the old getDefaultOrgId(), an unset value does NOT throw: the app must boot without it (an
// earlier outage came from clearing the dashboard variables). The audience routes show an
// "out-of-date link" card instead when it is missing.
export function getLegacyAudienceOrgId() {
  const orgId = import.meta.env.VITE_DEFAULT_ORG_ID;
  return typeof orgId === 'string' && orgId.trim() ? orgId.trim() : null;
}

// The slug of the organiser the OLD slug-less audience links mean (see above). Null when unset or blank:
// the shim then falls back to the org id, and with neither the old links show the "out of date" card.
export function getLegacyAudienceOrgSlug() {
  const slug = import.meta.env.VITE_LEGACY_AUDIENCE_ORG_SLUG;
  return typeof slug === 'string' && slug.trim() ? slug.trim() : null;
}

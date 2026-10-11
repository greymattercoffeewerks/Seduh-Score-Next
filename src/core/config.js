// Build-time settings. Deliberately separate from supabaseClient.js (that file's whole job is
// constructing the client, nothing about org selection).
//
// Which org the ORGANISER console works in is no longer a build-time setting: it comes from the
// signed-in person's memberships (core/orgContext.js, T-TEN.C1/C2). What remains is the anonymous
// audience screens (/live/projector, /live/phone, /live/splash), which have no signed-in person to ask
// and for now still show one org, named by `VITE_DEFAULT_ORG_ID`. T-TEN.D1 replaces that with
// slug-qualified links and a legacy slug variable, after which this goes away entirely.
//
// Unlike the old getDefaultOrgId(), an unset value does NOT throw: the app must boot without it (an
// earlier outage came from clearing the dashboard variables). The audience routes show an
// "out-of-date link" card instead when it is missing.
export function getLegacyAudienceOrgId() {
  const orgId = import.meta.env.VITE_DEFAULT_ORG_ID;
  return typeof orgId === 'string' && orgId.trim() ? orgId.trim() : null;
}

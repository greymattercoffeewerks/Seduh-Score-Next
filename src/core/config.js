// One org, no login (2026-08-29 app-wiring pass). This project has no
// organiser auth yet — the frozen handoff's own §4 framing assumes "one
// organiser, one org," provisioned outside the app via `service_role` — and
// none is being added now. `VITE_DEFAULT_ORG_ID` is the explicit,
// trivially-swappable placeholder for "which org" until real per-session
// org derivation exists later; kept deliberately separate from
// supabaseClient.js (that file's whole job is constructing the client,
// nothing about org selection).
export function getDefaultOrgId() {
  const orgId = import.meta.env.VITE_DEFAULT_ORG_ID;
  if (!orgId) {
    throw new Error(
      'VITE_DEFAULT_ORG_ID is not set — see .env.example. Required until real ' +
        'per-session org derivation exists; an unset value would otherwise produce ' +
        'confusing "zero rows everywhere" behavior with no indication why.',
    );
  }
  return orgId;
}

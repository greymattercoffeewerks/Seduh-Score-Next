// Permissive stub (handoff D14). No entitlement logic exists in this repo — the
// seam is built, the logic is not. `canAccess()` returns true for every real key
// below; this is the one file to change in October if tiering ever ships. Do not
// call this from any format/UI code yet (module-boundary-checker: zero call
// sites in Phase 2, and none should exist until entitlements are actually
// built).
const ENTITLEMENTS = {
  // Per-cupper/per-set difficulty analytics (§14 T4.7's analytics task).
  cup_taster_analytics: { minTier: null },
  // PDF/CSV report generation and export (§14 T4.7/T4.8).
  cup_taster_report: { minTier: null },
  // Caps on event count, cupper count, or similar volume limits for Cup Taster.
  cup_taster_unlimited: { minTier: null },
  // Enhanced audience-facing features beyond the baseline standings/heat-status
  // view (§8's viewer-shell + projector/phone surfaces).
  audience_enhanced: { minTier: null },
  // Custom branding on audience-facing live surfaces (§8).
  audience_branding: { minTier: null },
};

export function canAccess(key) {
  if (!(key in ENTITLEMENTS)) {
    throw new Error(`entitlements: unknown key "${key}"`);
  }
  return true;
}

// The module toggle mechanism (spec section 3b). A module is a toggle stored with the event's setup, never a code
// fork; the core knows no module exists. TD.1 ships the mechanism with NO module in the registry, so every attempt to
// switch one on is refused with a reason, never silently ignored. A later phase adds a module by adding one entry.
//
// An entry: { key, label, requires: [keys it needs on], entitlementKey }. The database holds the same registry
// (app.td_module_registry); the two are changed together.
export const MODULES = Object.freeze([]);

export function moduleKeys(registry = MODULES) {
  return registry.map((m) => m.key);
}

// Checks a selection ({ key: true|false|config }). Returns the problems as { code, module, needs? }; empty = valid.
// `unknown`: no such module. `dependency`: it needs another module that is not on.
export function moduleProblems(selection, registry = MODULES) {
  const problems = [];
  const byKey = new Map(registry.map((m) => [m.key, m]));
  const on = (key) => Boolean(selection?.[key]);
  for (const key of Object.keys(selection ?? {})) {
    if (!on(key)) continue;
    const mod = byKey.get(key);
    if (!mod) {
      problems.push({ code: 'unknown', module: key });
      continue;
    }
    for (const need of mod.requires ?? []) {
      if (!on(need)) problems.push({ code: 'dependency', module: key, needs: need });
    }
  }
  return problems;
}

// What the setup stores: only the switched-on modules, so one that is off leaves no trace anywhere.
export function enabledModules(selection) {
  return Object.fromEntries(Object.entries(selection ?? {}).filter(([, v]) => Boolean(v)));
}

// Setup is locked from the moment Round 1 exists (not when the draw is confirmed).
export function isSetupLocked(rounds) {
  return rounds.length > 0;
}

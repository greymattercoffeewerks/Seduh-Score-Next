// Fails the build when the platform admin console's code reaches a bundle that is not the admin console's own.
//
// The organiser console and the audience pages ship to people who must never receive admin code (src/admin/CLAUDE.md).
// src/admin/boundary.test.js stops an import from reaching it at source level; this reads what was actually built:
// every JavaScript file in dist/assets except the admin entry's own (`admin-<hash>.js`) must be free of strings only the
// admin console contains. Run it after `npm run build` (CI does).
//
//   node tools/check-admin-bundle-leak.mjs [dist directory]
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Words that exist only in src/admin/: the Edge Function and database functions the console calls, and a heading
// from its New organisation panel. A new admin-only call or screen name belongs here. Each one must also be in the
// admin chunk (the CLI fails otherwise), so a renamed call cannot leave this list guarding nothing.
export const ADMIN_ONLY_STRINGS = Object.freeze([
  'admin-accounts',
  'admin_create_org',
  'admin_find_user',
  'admin_list_orgs',
  'admin_can_provision',
  'am_i_platform_admin',
  'New organisation',
  'admin_plan_org',
  'admin_payment_confirm',
  'admin_list_keys',
  'admin_seduh_id_counts',
  'admin_gating_preview',
  'admin_set_key_enforced',
  'admin_grant_create',
  'admin_grant_extend',
  'admin_grant_revoke',
  'admin_event_release',
  'admin_event_resnapshot',
  'seduh-admin-check',
  'Sign out everywhere',
]);

// The admin entry's own chunk and nothing else: Vite names it after the `admin` input (vite.config.js), with an
// 8-character hash, so a shared chunk that happens to be called admin-something-hash is still checked.
export const isAdminChunk = (name) => /^admin-[A-Za-z0-9_-]{8}\.js$/.test(name);

// The admin-only strings the admin chunk does NOT contain (a canary: the list above has drifted from the code).
export function missingFromAdminChunk(distDir, strings = ADMIN_ONLY_STRINGS) {
  const assets = join(distDir, 'assets');
  const name = readdirSync(assets).find(isAdminChunk);
  if (!name) return null;
  const source = readFileSync(join(assets, name), 'utf8');
  return strings.filter((string) => !source.includes(string));
}

// Every `{ file, string }` pair where a built file outside the admin chunk contains an admin-only string.
export function findAdminLeaks(distDir, strings = ADMIN_ONLY_STRINGS) {
  const assets = join(distDir, 'assets');
  const files = readdirSync(assets).filter((name) => name.endsWith('.js'));
  const leaks = [];
  for (const name of files) {
    if (isAdminChunk(name)) continue;
    const source = readFileSync(join(assets, name), 'utf8');
    for (const string of strings) if (source.includes(string)) leaks.push({ file: name, string });
  }
  return { scanned: files.length, leaks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distDir = resolve(process.argv[2] ?? 'dist');
  let result;
  try {
    result = findAdminLeaks(distDir);
  } catch (error) {
    console.error(`Could not read ${distDir}/assets (run npm run build first): ${error.message}`);
    process.exit(2);
  }
  const missing = missingFromAdminChunk(distDir);
  if (missing === null) {
    console.error(
      'No admin chunk (assets/admin-<hash>.js) in the build: the check cannot tell what is a leak.',
    );
    process.exit(2);
  }
  if (missing.length > 0) {
    console.error(
      `The admin chunk no longer contains ${missing.map((s) => `"${s}"`).join(', ')}: update ADMIN_ONLY_STRINGS in tools/check-admin-bundle-leak.mjs.`,
    );
    process.exit(2);
  }
  if (result.leaks.length > 0) {
    for (const { file, string } of result.leaks) {
      console.error(`Admin-only text "${string}" found in assets/${file}`);
    }
    process.exit(1);
  }
  console.log(`No admin-only text outside the admin chunk (${result.scanned} files scanned).`);
}

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeAdminError, ADMIN_ERROR_COPY, GENERIC_ERROR } from './adminErrors.js';

// The hints the console can meet are READ FROM the migrations and the admin-accounts function, not typed here.
// Every `hint = '...'` in a migration and every `hint: '...'` in the function must either have words in
// ADMIN_ERROR_COPY or be listed below as NOT for the console, with the reason. A new hint therefore fails this
// test until someone decides which it is, instead of showing the operator the generic sentence by accident.

const REPO = process.cwd();

function hintsInMigrations() {
  const dir = join(REPO, 'supabase', 'migrations');
  const found = new Set();
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql'))) {
    for (const match of readFileSync(join(dir, name), 'utf8').matchAll(
      /\bhint\s*=\s*'([a-z_]+)'/g,
    )) {
      found.add(match[1]);
    }
  }
  return found;
}

function hintsInAdminFunction() {
  const source = readFileSync(
    join(REPO, 'supabase', 'functions', 'admin-accounts', 'handler.js'),
    'utf8',
  );
  return new Set([...source.matchAll(/\bhint:\s*'([a-z_]+)'/g)].map((match) => match[1]));
}

// Raised by something the admin console never calls, or never shows as such.
const NOT_FOR_THE_CONSOLE = {
  // admin_record_account_create (service role only): the Edge Function logs these and answers account_record_failed.
  account_not_new: 'logged by admin-accounts, surfaced as account_record_failed',
  already_recorded: 'logged by admin-accounts, surfaced as account_record_failed',
  // The anonymous public-results door.
  payload_too_large: 'public results publishing, not the console',
  entitlement_required:
    'entitlement hooks refuse an organiser write; the organiser surface has no copy for them yet (G-C2)',
  entitlement_cap_reached:
    'entitlement hooks, raised to the organiser console users, not the admin console',
  // The roster edit RPC (update_roster_entry) and the owner-run phone migration guard.
  phone_invalid: 'update_roster_entry, the organiser roster edit; not an admin console call',
  people_phone_not_repaired:
    'raised only by the owner-run people_phone_e164 migration guard, never over the API',
  // Seduh ID link (T-ID.B2): the guard on people.global_person_id (organiser roster writes) and the owner-run FK guard.
  global_person_id_database_only:
    'people guard trigger, raised to an organiser writing the roster; not an admin console call',
  people_global_person_id_unknown:
    'raised only by the owner-run people_global_person_id_fkey migration guard, never over the API',
  // Seduh ID backfill (T-ID.B4): owner-run function, refuses an API role.
  seduh_backfill_owner_only:
    'raised only to an API role calling the owner-run identity backfill; never an admin console call',
  archive_tick_owner_only:
    'raised only to an API role calling the owner-run archive tick; never an admin console call',
  // The archive snapshot staging door (T-ARC.2): the organiser's browser, through the outbox; no copy is shown, the call is silent.
  archive_payload_invalid:
    'stage_archive_payload refusing a snapshot that can never be valid; the organiser client never builds one, never an admin console call',
  archive_payload_too_large:
    'stage_archive_payload refusing a snapshot over 64 KB; the organiser client never builds one, never an admin console call',
  // The BTC format's own RPCs.
  bracket_advanced: 'BTC format',
  demo_event_not_found: 'BTC format',
  demo_not_btc: 'BTC format',
  demo_not_test: 'BTC format',
  seeding_bracket_exists: 'BTC format',
  seeding_event_not_found: 'BTC format',
  seeding_group_incomplete: 'BTC format',
  seeding_group_invalid: 'BTC format',
  seeding_not_tied: 'BTC format',
  seeding_preliminary_open: 'BTC format',
  seeding_reason_required: 'BTC format',
  seeding_reason_too_long: 'BTC format',
  tiebreak_match_not_found: 'BTC format',
  tiebreak_not_tied: 'BTC format',
  tiebreak_unconfirmed: 'BTC format',
};

describe('the hint copy covers every hint the console can meet', () => {
  const all = new Set([...hintsInMigrations(), ...hintsInAdminFunction()]);

  it('reads a believable set of hints from the repository', () => {
    expect(all.size).toBeGreaterThan(30);
    for (const known of ['admin_required', 'last_owner', 'org_slug_taken', 'email_taken']) {
      expect(all.has(known)).toBe(true);
    }
  });

  it('every hint is either given words or explicitly not for the console', () => {
    const unclassified = [...all].filter(
      (hint) => !Object.hasOwn(ADMIN_ERROR_COPY, hint) && !Object.hasOwn(NOT_FOR_THE_CONSOLE, hint),
    );
    expect(unclassified).toEqual([]);
  });

  it('nothing is both given words and listed as not for the console', () => {
    expect(Object.keys(NOT_FOR_THE_CONSOLE).filter((hint) => hint in ADMIN_ERROR_COPY)).toEqual([]);
  });

  it('no stray copy for a hint that no longer exists anywhere', () => {
    expect(Object.keys(ADMIN_ERROR_COPY).filter((hint) => !all.has(hint))).toEqual([]);
  });

  it('the exclusion list names no hint that no longer exists', () => {
    expect(Object.keys(NOT_FOR_THE_CONSOLE).filter((hint) => !all.has(hint))).toEqual([]);
  });
});

describe('describeAdminError', () => {
  it.each(Object.keys(ADMIN_ERROR_COPY))('has its own plain sentence for %s', (hint) => {
    const text = describeAdminError({ hint });
    expect(text).toBe(ADMIN_ERROR_COPY[hint]);
    expect(text).not.toBe(GENERIC_ERROR);
    expect(text.length).toBeGreaterThan(10);
  });

  it('falls back to the generic sentence for an unknown, missing or non-string hint', () => {
    for (const error of [{ hint: 'new_unlisted_hint' }, {}, null, undefined, { hint: 7 }]) {
      expect(describeAdminError(error)).toBe(GENERIC_ERROR);
    }
  });

  it('never matches on message text, and never returns an inherited object property', () => {
    expect(describeAdminError({ message: 'org_slug_taken' })).toBe(GENERIC_ERROR);
    expect(describeAdminError({ hint: 'toString' })).toBe(GENERIC_ERROR);
    expect(describeAdminError({ hint: '__proto__' })).toBe(GENERIC_ERROR);
  });

  it('copy mentions no raw SQLSTATE, table or function names', () => {
    for (const text of Object.values(ADMIN_ERROR_COPY)) {
      expect(text).not.toMatch(/\b(42501|22023|23505|P0001|app\.|public\.|auth\.|rpc)\b/);
    }
  });
});

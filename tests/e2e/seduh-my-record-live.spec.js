import { randomUUID, randomInt } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createLoneUser, createTenant } from './support/tenants.js';
import { sqlAsOwner } from './support/admins.js';
import { rpc, send, signInPassword } from './support/api.js';
import { buildRecord, toSql } from '../../scripts/seduh-id-record/lib.mjs';

// T-ID2.D-a: a claimed person's OWN record over the REAL local stack (PostgREST, Auth, real JWTs, no browser): the
// signed-in competitor calls the person's doors (my record, add and edit an entry, the team picker and a team link, settings),
// and the public profile and country doors then show exactly what the settings allow. Also: who is refused (anon, a login with
// no account, an organiser), and the owner's record loader run against the same database, twice. pgTAP 085 proves the same
// rules inside the database; this proves what travels over HTTP and that the loader's SQL really loads.
// Everything is fictional: a unique handle, login, identity and an invented team in the invented country XA.

const unique = () => randomUUID().replaceAll('-', '').slice(0, 10);
const phone = () => `+673${String(randomInt(0, 1e9)).padStart(9, '0')}`;
const sqlText = (s) => `'${String(s).replaceAll("'", "''")}'`;
const DENIED = [401, 403];

// A claimed person (login, identity, open account), made by owner SQL the way pgTAP does. Returns the handle and a token.
async function claimedPerson(label) {
  const handle = `${label}${unique()}`;
  const user = await createLoneUser(label);
  const [identityId, accountId] = [randomUUID(), randomUUID()];
  sqlAsOwner(
    `insert into app.seduh_identities (id, phone_e164, display_name, source, country_code) values ('${identityId}', '${phone()}', ${sqlText(`Record Proof ${label}`)}, 'organiser_roster', 'BN');` +
      `insert into app.seduh_accounts (id, identity_id, user_id, handle, claim_method, adult_attested_at) values ('${accountId}', '${identityId}', '${user.userId}', ${sqlText(handle)}, 'organiser_link', now());`,
  );
  const { token } = await signInPassword(user);
  return { handle, token, accountId, user };
}

// An invented team in an invented country, two listed years (a unique team name, so a re-run never collides)
function seedTeam(name) {
  sqlAsOwner(
    `insert into app.historical_results (competition, competition_name, edition_year, team_name, country_code, stage_reached, source_ref, supplied_by, supplied_on, permission_ref) values ` +
      `('btc', 'Record Proof Championship', 2024, ${sqlText(name)}, 'XA', 'quarter_final', 'x', 'x', '2026-11-01', 'test'),` +
      `('btc', 'Record Proof Championship', 2023, ${sqlText(name)}, 'XA', 'preliminary', 'x', 'x', '2026-11-01', 'test');`,
  );
}

const profile = async (handle) =>
  (await rpc('public_seduh_profile', { p_handle: handle }, { token: null })).body;
const country = async (code) =>
  (await rpc('public_country_record', { p_country_code: code }, { token: null })).body;

test('a competitor writes their own record and the public doors show it as the settings allow', async () => {
  const me = await claimedPerson('mine');
  const team = `Proof Team ${unique()}`;
  seedTeam(team);

  // an empty record first
  let r = await rpc('seduh_my_record', {}, { token: me.token });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body.entries).toEqual([]);
  expect(r.body.settings.listed_on_country_pages).toBe(false);
  expect(r.body.account.handle).toBe(me.handle);

  // an entry: add, edit, see it on the public page labelled self_reported
  const add = await rpc(
    'seduh_add_entry',
    {
      p_year: 2025,
      p_competition_name: 'Record Proof Open',
      p_kind: 'competed',
      p_location: 'Proofville',
      p_result_text: '2nd',
      p_placement: 2,
    },
    { token: me.token },
  );
  expect(add.status, JSON.stringify(add.body)).toBe(200);
  expect(add.body.provenance).toBe('self_reported');
  const edit = await rpc(
    'seduh_update_entry',
    {
      p_entry_id: add.body.id,
      p_year: 2025,
      p_competition_name: 'Record Proof Open',
      p_kind: 'competed',
      p_result_text: 'Champion',
      p_placement: 1,
    },
    { token: me.token },
  );
  expect(edit.status, JSON.stringify(edit.body)).toBe(200);
  let page = await profile(me.handle);
  expect(page.self_reported).toHaveLength(1);
  expect(page.self_reported[0]).toMatchObject({
    competition_name: 'Record Proof Open',
    result_text: 'Champion',
    placement: 1,
    provenance: 'self_reported',
  });
  expect(page.recorded_results).toEqual([]);

  // a team link through the picker
  const options = await rpc('seduh_team_options', { p_country_code: 'XA' }, { token: me.token });
  expect(options.status, JSON.stringify(options.body)).toBe(200);
  const mine = options.body.teams.filter((t) => t.team_name === team);
  expect(mine.map((t) => t.edition_year)).toEqual([2024, 2023]);
  expect(JSON.stringify(options.body)).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  );
  const link = await rpc(
    'seduh_add_team_link',
    { p_team_key: mine[0].team_key },
    { token: me.token },
  );
  expect(link.status, JSON.stringify(link.body)).toBe(200);
  expect(link.body.membership).toBe('self_reported');
  page = await profile(me.handle);
  expect(page.organiser_records).toEqual([
    expect.objectContaining({
      team_name: team,
      edition_year: 2024,
      membership: 'self_reported',
      provenance: 'organiser_archive',
    }),
  ]);

  // the country page lists nobody until they opt in
  let championship = (await country('XA')).championships.find((c) => c.edition_year === 2024);
  expect(championship.teams.find((t) => t.team_name === team).members).toEqual([]);
  const settings = await rpc(
    'seduh_set_my_settings',
    { p_settings: { listed_on_country_pages: true } },
    { token: me.token },
  );
  expect(settings.status, JSON.stringify(settings.body)).toBe(200);
  championship = (await country('XA')).championships.find((c) => c.edition_year === 2024);
  expect(championship.teams.find((t) => t.team_name === team).members).toEqual([
    { handle: me.handle, display_name: 'Record Proof mine', membership: 'self_reported' },
  ]);

  // hiding a section hides it from the public page, at once
  await rpc(
    'seduh_set_my_settings',
    { p_settings: { vis_self_reported_results: 'hidden', vis_organiser_results: 'hidden' } },
    { token: me.token },
  );
  page = await profile(me.handle);
  expect(page.self_reported).toEqual([]);
  expect(page.organiser_records).toEqual([]);
  championship = (await country('XA')).championships.find((c) => c.edition_year === 2024);
  expect(championship.teams.find((t) => t.team_name === team).members).toEqual([]);

  // delete the entry and remove the link
  expect(
    (await rpc('seduh_delete_entry', { p_entry_id: add.body.id }, { token: me.token })).status,
  ).toBe(204);
  expect(
    (await rpc('seduh_remove_team_link', { p_link_id: link.body.id }, { token: me.token })).status,
  ).toBe(204);
  r = await rpc('seduh_my_record', {}, { token: me.token });
  expect(r.body.counts).toMatchObject({ entries: 0, team_links: 0 });
});

test('nobody but the open account can write: anon, a login with no account, an organiser, and another person', async () => {
  const owner = await claimedPerson('zulu');
  const other = await claimedPerson('yankee');
  const entry = await rpc(
    'seduh_add_entry',
    { p_year: 2025, p_competition_name: 'Mine Only', p_kind: 'judged' },
    { token: owner.token },
  );
  expect(entry.status, JSON.stringify(entry.body)).toBe(200);

  // anon: no execute grant at all
  for (const [name, args] of [
    ['seduh_my_record', {}],
    ['seduh_add_entry', { p_year: 2025, p_competition_name: 'x', p_kind: 'judged' }],
    ['seduh_set_my_settings', { p_settings: { vis_identity: 'hidden' } }],
  ]) {
    const a = await rpc(name, args, { token: null });
    expect(DENIED, `${name}: ${JSON.stringify(a.body)}`).toContain(a.status);
  }

  // a login with no account, and an organiser: the same refusal, hint no_account
  const lone = await createLoneUser('noacct');
  const loneToken = (await signInPassword(lone)).token;
  const tenant = await createTenant({ live: false });
  const organiser = await signInPassword({ email: tenant.email, password: tenant.password });
  for (const token of [loneToken, organiser.token]) {
    const a = await rpc(
      'seduh_add_entry',
      { p_year: 2025, p_competition_name: 'x', p_kind: 'judged' },
      { token },
    );
    expect(a.status, JSON.stringify(a.body)).toBe(403);
    expect(a.body.hint).toBe('no_account');
    const b = await rpc('seduh_my_record', {}, { token });
    expect(b.body.hint).toBe('no_account');
  }

  // another person cannot touch my entry: not_found, and it is unchanged
  const edit = await rpc(
    'seduh_update_entry',
    { p_entry_id: entry.body.id, p_year: 2020, p_competition_name: 'Hijack', p_kind: 'judged' },
    { token: other.token },
  );
  expect(edit.status).toBe(400);
  expect(edit.body.hint).toBe('not_found');
  const del = await rpc(
    'seduh_delete_entry',
    { p_entry_id: entry.body.id },
    { token: other.token },
  );
  expect(del.body.hint).toBe('not_found');
  expect((await profile(owner.handle)).self_reported[0].competition_name).toBe('Mine Only');

  // a person cannot read the tables directly (the app schema is not exposed, and no grant exists)
  const direct = await send('/rest/v1/seduh_self_reported_entries?select=*', {
    token: owner.token,
  });
  expect([401, 403, 404, 406]).toContain(direct.status);
});

test('the loader loads a record into the database, twice, and creates unconfirmed team links', async () => {
  const me = await claimedPerson('loader');
  const team = `Loader Team ${unique()}`;
  seedTeam(team);
  const csv = [
    'edition_year,competition_name,kind,role,result,team_link,location,provenance_now,provenance_possible,notes',
    `2024,Record Proof Championship,competed,team member,Quarter-final,${team} (XA) 2024,Proofville,x,y,`,
    `2023,Record Proof Championship,competed,captain,Preliminaries,${team} (XA) 2023,Proofville,x,y,`,
    '2025,Loader Brew Cup,competed,competitor,2nd,,Proofville,self-reported,,A note',
    '2025,Loader Jam,judged,head judge,,,Proofville,self-reported,,',
    '2024,Loader Cup Taster,organised,organiser,,,Proofville,self-reported,,',
  ].join('\n');
  const data = buildRecord({ csvText: csv, currentYear: 2027 });
  expect(data.errors).toEqual([]);
  const sql = toSql(data, { handle: me.handle });

  sqlAsOwner(sql);
  const first = await rpc('seduh_my_record', {}, { token: me.token });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.counts).toMatchObject({
    entries: 3,
    team_links: 2,
    by_kind: { competed: 1, judged: 1, organised: 1 },
  });
  expect(first.body.entries.map((e) => e.competition_name).sort()).toEqual([
    'Loader Brew Cup',
    'Loader Cup Taster',
    'Loader Jam',
  ]);
  expect(first.body.entries.find((e) => e.competition_name === 'Loader Brew Cup')).toMatchObject({
    placement: 2,
    result_text: '2nd',
  });
  expect(first.body.team_links.map((l) => `${l.edition_year}:${l.role}:${l.membership}`)).toEqual([
    '2024:member:self_reported',
    '2023:captain:self_reported',
  ]);

  // the second run changes nothing (same rows, same ids, untouched timestamps)
  const stamp = () =>
    sqlAsOwner(
      `select count(*) || ' ' || max(updated_at) from app.seduh_self_reported_entries where account_id = '${me.accountId}'`,
    );
  const before = stamp();
  sqlAsOwner(sql);
  expect(stamp()).toBe(before);
  const second = await rpc('seduh_my_record', {}, { token: me.token });
  expect(second.body.entries.map((e) => e.id).sort()).toEqual(
    first.body.entries.map((e) => e.id).sort(),
  );
  expect(second.body.counts).toEqual(first.body.counts);

  // a team-year that does not exist stops the whole load: nothing half-loads
  const missing = buildRecord({
    csvText: csv
      .replace(`${team} (XA) 2023`, `${team} (XA) 2022`)
      .replace('Loader Jam', 'Loader Jam Two'),
    currentYear: 2027,
  });
  expect(() => sqlAsOwner(toSql(missing, { handle: me.handle }))).toThrow(
    /no team in app.historical_results/,
  );
  const third = await rpc('seduh_my_record', {}, { token: me.token });
  expect(third.body.counts).toEqual(first.body.counts);
  expect(third.body.entries.some((e) => e.competition_name === 'Loader Jam Two')).toBe(false);

  // and a handle that is not an open claimed account stops it too
  expect(() => sqlAsOwner(toSql(data, { handle: `nobody${unique()}` }))).toThrow(
    /no OPEN claimed Seduh ID/,
  );
});

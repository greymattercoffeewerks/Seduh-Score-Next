// A platform admin for the admin console end-to-end tests (T-ADM.D1), made the only way one can be made:
// by SQL, as the database owner. There is no API, no migration and no seed row that makes an admin (spec D-A1,
// CONVENTIONS.md): the account is an ordinary login created through the Auth admin API (support/tenants.js),
// and the `app.platform_admins` row is inserted through `docker exec ... psql` against the local database
// container, the same route the manual end-to-end script for the admin-accounts function uses.
//
// This only ever works against the local Supabase stack these tests already require (`supabase start`, in CI
// too): the container is named after the project id in supabase/config.toml, and the address is checked by
// tenants.js before any account is made.
import { execFileSync } from 'node:child_process';
import { generate } from 'otplib';
import { createLoneUser } from './tenants.js';

const DB_CONTAINER = process.env.SEDUH_DB_CONTAINER || 'supabase_db_seduh-score-next';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sql(statement) {
  return execFileSync(
    'docker',
    [
      'exec',
      DB_CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  );
}

/** A new login with no organisation, made a platform admin. It has no second factor yet: its first sign-in enrols one. */
export async function createPlatformAdmin(label = 'admin') {
  const person = await createLoneUser(label);
  if (!UUID.test(person.userId)) throw new Error('the Auth API returned an unexpected user id');
  sql(
    `insert into app.platform_admins (user_id, note) values ('${person.userId}', 'e2e test admin (removed after the run)')`,
  );
  return person;
}

/** Removes the admin row so a persistent local stack does not accumulate admins. The login itself is left, as the other specs leave theirs. */
export function removePlatformAdmin(person) {
  if (!UUID.test(person.userId)) throw new Error('not a user id');
  sql(`delete from app.platform_admins where user_id = '${person.userId}'`);
}

const used = new Map();

/**
 * The six digits an authenticator app would show for `secret`. The server accepts the current 30-second
 * period's code and the one either side of it (probed 2026-10-15 against the local GoTrue: +-1 accepted, +-2
 * refused), and the local stack does not refuse a repeated code. So that a test never depends on that
 * leniency where it does not need to, this hands out a code it has not handed out before when one of the three
 * is free, and only otherwise repeats the current one.
 */
export async function nextCode(secret) {
  const spent = used.get(secret) ?? new Set();
  used.set(secret, spent);
  const now = Math.floor(Date.now() / 1000);
  const current = await generate({ secret, epoch: now });
  for (const step of [0, 1, -1]) {
    const code = await generate({ secret, epoch: now + step * 30 });
    if (!spent.has(code)) {
      spent.add(code);
      return code;
    }
  }
  return current;
}

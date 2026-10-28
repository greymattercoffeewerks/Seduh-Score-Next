// Real organisations for the audience end-to-end tests (T-TEN.D5), created through the same doors production uses.
//
// An organisation can only be created by the service role (`create_org`, T-TEN.A3: the ONLY path that makes one),
// so a test that needs a SECOND organisation signs a service-role key for the local stack and calls that. Every
// other write (the event, the live session) is then done AS THE NEW ORGANISER, with their own access token, so
// the same row-level security a real organiser meets is what lets the write through. The signing secret is the
// Supabase CLI's published local-development one; it only ever works against the local stack these tests run
// against (a cloud project has its own secret), and CI's `supabase start` uses the same default.
import { createHmac, randomUUID } from 'node:crypto';

const API = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54421';
const LOCAL_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const PASSWORD = 'local-dev-password';

function base64url(object) {
  return Buffer.from(JSON.stringify(object)).toString('base64url');
}

// `iat` is a minute in the past on purpose: the local stack runs in a Docker VM whose clock can lag the host's (after a
// sleep or a restart), and PostgREST refuses a token issued in the future (PGRST303) with no tolerance at all.
function signLocalKey(role) {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url({ iss: 'supabase-demo', role, iat: now - 60, exp: now + 3600 });
  const signature = createHmac('sha256', LOCAL_JWT_SECRET)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${signature}`;
}

// These helpers sign with a PUBLISHED secret and create real users and organisations: they must only ever
// run against a stack on this machine. A cloud project would refuse the key, but another local stack with the
// CLI's default secret would not, so the address is checked before anything is written.
function assertLocalStack() {
  const host = new URL(API).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new Error(`tenants.js only runs against a local Supabase stack, not ${host}`);
  }
}

async function call(path, { method = 'GET', key, token, body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${token ?? key}`,
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/**
 * A token signed with the local stack's PUBLISHED secret and exactly the claims given: for tests that must hand the
 * database a validly signed token with wrong or stale claims (the gateway accepts it; the database's own gate must not).
 */
export function signLocalToken(payload) {
  assertLocalStack();
  const head = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url(payload);
  const signature = createHmac('sha256', LOCAL_JWT_SECRET)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${signature}`;
}

/** The local service-role key (the Auth admin API and the service-only functions). Local stack only. */
export function serviceRoleKey() {
  assertLocalStack();
  return signLocalKey('service_role');
}

/** The public (anon) key and API address of the local stack, for tests that talk to the database directly. */
export function localStack() {
  assertLocalStack();
  return { api: API, anonKey: process.env.VITE_SUPABASE_ANON_KEY || signLocalKey('anon') };
}

/**
 * Makes an existing person a member of an organisation, through the service-role door provisioning uses
 * (org_add_existing_member), so one person can belong to two organisations. `role` is 'owner' or 'organiser'.
 */
export async function addMember(tenant, person, role = 'organiser') {
  assertLocalStack();
  await call('/rest/v1/rpc/org_add_existing_member', {
    method: 'POST',
    key: signLocalKey('service_role'),
    body: { p_org_id: tenant.orgId, p_user_id: person.userId, p_role: role },
  });
}

/** A signed-up person who belongs to NO organisation (an account made for something else, or someone removed). */
export async function createLoneUser(label, { userMetadata } = {}) {
  assertLocalStack();
  const unique = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const email = `d5-lone-${label}-${unique}@local.test`;
  const user = await call('/auth/v1/admin/users', {
    method: 'POST',
    key: signLocalKey('service_role'),
    body: {
      email,
      password: PASSWORD,
      email_confirm: true,
      ...(userMetadata ? { user_metadata: userMetadata } : {}),
    },
  });
  return { userId: user.id, email, password: PASSWORD };
}

/**
 * Creates one organisation with its own organiser, one event and one ACTIVE live session carrying `payload`.
 * Slugs and emails are unique per run, so a persistent local stack is never collided with.
 *
 * `grant` is the plan the organisation is given through `admin_grant_create` with a real platform-admin session
 * (support/grants.js; the only grant writer there is): 'annual' by default, so a spec passes whether or not a gating
 * key is enforced. `grant: false` leaves the organisation on Community (the negative case). `live: false` makes the
 * organisation and its organiser only: no event and no live session (use `createEvent` and `goLive` below).
 */
export async function createTenant({
  label,
  format,
  payload,
  eventName,
  grant = 'annual',
  live: withLive = true,
}) {
  assertLocalStack();
  const serviceKey = signLocalKey('service_role');
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || signLocalKey('anon');
  const unique = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const slug = `d5-${label}-${unique}`;
  const email = `${slug}@local.test`;

  const user = await call('/auth/v1/admin/users', {
    method: 'POST',
    key: serviceKey,
    body: { email, password: PASSWORD, email_confirm: true },
  });
  const orgId = await call('/rest/v1/rpc/create_org', {
    method: 'POST',
    key: serviceKey,
    body: { p_name: `D5 ${label} ${unique}`, p_slug: slug, p_owner_user_id: user.id },
  });
  const session = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    key: anonKey,
    body: { email, password: PASSWORD },
  });
  const token = session.access_token;

  // The plan is given before the first event or go-live, so a gating key that is enforced already sees it. Imported
  // here, not at the top, because grants.js imports this file.
  let grantId = null;
  if (grant) {
    const { grantPlan } = await import('./grants.js');
    grantId = await grantPlan(orgId, grant);
  }

  const liveIds = [];
  const createEvent = async ({ format: eventFormat, name }) => {
    const [row] = await call('/rest/v1/events', {
      method: 'POST',
      key: anonKey,
      token,
      headers: { prefer: 'return=representation' },
      body: {
        org_id: orgId,
        format: eventFormat,
        name,
        city: 'Testville',
        event_date: '2026-10-12',
        status: 'active',
        is_test: false,
      },
    });
    return row;
  };
  // Takes an event live. Throws (message carries the status and the database's answer) when the database refuses.
  const goLive = async ({ eventId: forEvent, format: liveFormat, payload: livePayload }) => {
    const [row] = await call('/rest/v1/live_sessions', {
      method: 'POST',
      key: anonKey,
      token,
      headers: { prefer: 'return=representation' },
      body: {
        org_id: orgId,
        event_id: forEvent,
        format: liveFormat,
        active: true,
        payload: livePayload,
      },
    });
    liveIds.push(row.id);
    return row;
  };

  const event = withLive ? await createEvent({ format, name: eventName }) : null;
  const live = withLive ? await goLive({ eventId: event.id, format, payload }) : null;

  return {
    slug,
    orgId,
    userId: user.id,
    email,
    password: PASSWORD,
    eventId: event?.id,
    liveId: live?.id,
    grantId,
    createEvent,
    goLive,
    orgName: `D5 ${label} ${unique}`,
    /** The organiser publishes a new live payload (what a heat starting or finishing does). */
    async publish(nextPayload) {
      await call(`/rest/v1/live_sessions?id=eq.${live.id}`, {
        method: 'PATCH',
        key: anonKey,
        token,
        body: { payload: nextPayload },
      });
    },
    /**
     * Best effort: ends the live session so nothing is left live. The organisation, its organiser and the event
     * stay: the database refuses to remove a sole owner (T-TEN.A5) and the service role has no table access to
     * delete the organisation. Slugs and emails are unique per run, so leftovers never collide.
     */
    async cleanUp() {
      for (const id of liveIds) {
        try {
          await call(`/rest/v1/live_sessions?id=eq.${id}`, {
            method: 'PATCH',
            key: anonKey,
            token,
            body: { active: false },
          });
        } catch {
          // the stack may already be gone
        }
      }
    },
  };
}

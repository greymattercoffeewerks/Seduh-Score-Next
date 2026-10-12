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

function signLocalKey(role) {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url({ iss: 'supabase-demo', role, iat: now - 10, exp: now + 3600 });
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
 * Creates one organisation with its own organiser, one event and one ACTIVE live session carrying `payload`.
 * Slugs and emails are unique per run, so a persistent local stack is never collided with.
 */
export async function createTenant({ label, format, payload, eventName }) {
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

  const [event] = await call('/rest/v1/events', {
    method: 'POST',
    key: anonKey,
    token,
    headers: { prefer: 'return=representation' },
    body: {
      org_id: orgId,
      format,
      name: eventName,
      city: 'Testville',
      event_date: '2026-10-12',
      status: 'active',
      is_test: false,
    },
  });
  const [live] = await call('/rest/v1/live_sessions', {
    method: 'POST',
    key: anonKey,
    token,
    headers: { prefer: 'return=representation' },
    body: { org_id: orgId, event_id: event.id, format, active: true, payload },
  });

  return {
    slug,
    orgId,
    userId: user.id,
    eventId: event.id,
    liveId: live.id,
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
      try {
        await call(`/rest/v1/live_sessions?id=eq.${live.id}`, {
          method: 'PATCH',
          key: anonKey,
          token,
          body: { active: false },
        });
      } catch {
        // the stack may already be gone
      }
    },
  };
}

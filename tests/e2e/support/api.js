// Talking to the local stack's HTTP API the way a hostile client would: with real, forged or stale tokens, to the
// REST doors and the Auth API directly, never through the console's page. Used by the adversarial pass
// (admin-console-adversarial.spec.js). Everything here only ever runs against the local stack (tenants.js checks).
import { createHmac } from 'node:crypto';
import { generate } from 'otplib';
import { localStack } from './tenants.js';

const { api, anonKey } = localStack();

async function send(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      ...(token === null ? {} : { authorization: `Bearer ${token ?? anonKey}` }),
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: keep the text
  }
  return { status: response.status, body: parsed };
}

/** An admin or organiser signs in with a password: an `aal1` session. */
export async function signInPassword({ email, password }) {
  const { status, body } = await send('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  if (status !== 200) throw new Error(`sign-in refused: ${status} ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

/** Enrols a TOTP factor on the session and verifies it: the returned token is an `aal2` session. */
export async function enrolTotp(token) {
  const enrol = await send('/auth/v1/factors', {
    method: 'POST',
    token,
    body: { factor_type: 'totp', friendly_name: `adversarial-${Date.now()}` },
  });
  if (enrol.status !== 200)
    throw new Error(`enrol refused: ${enrol.status} ${JSON.stringify(enrol.body)}`);
  const factorId = enrol.body.id;
  const secret = enrol.body.totp.secret;
  const challenge = await send(`/auth/v1/factors/${factorId}/challenge`, {
    method: 'POST',
    token,
    body: {},
  });
  if (challenge.status !== 200) throw new Error(`challenge refused: ${challenge.status}`);
  const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
  const verify = await send(`/auth/v1/factors/${factorId}/verify`, {
    method: 'POST',
    token,
    body: { challenge_id: challenge.body.id, code },
  });
  if (verify.status !== 200)
    throw new Error(`verify refused: ${verify.status} ${JSON.stringify(verify.body)}`);
  return { token: verify.body.access_token, secret, factorId };
}

/** A later sign-in: the account already has a verified factor, so the session is raised to `aal2` by answering it. */
export async function elevate(token, { factorId, secret }) {
  const challenge = await send(`/auth/v1/factors/${factorId}/challenge`, {
    method: 'POST',
    token,
    body: {},
  });
  if (challenge.status !== 200) throw new Error(`challenge refused: ${challenge.status}`);
  const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) });
  const verify = await send(`/auth/v1/factors/${factorId}/verify`, {
    method: 'POST',
    token,
    body: { challenge_id: challenge.body.id, code },
  });
  if (verify.status !== 200)
    throw new Error(`verify refused: ${verify.status} ${JSON.stringify(verify.body)}`);
  return verify.body.access_token;
}

/** POST /rest/v1/rpc/<name>. `token: null` sends no Authorization header at all. */
export function rpc(name, args = {}, { token, headers } = {}) {
  return send(`/rest/v1/rpc/${name}`, { method: 'POST', token, body: args, headers });
}

/** Any other REST door: a table, a view. */
export function rest(path, { method = 'GET', token, body, headers } = {}) {
  return send(`/rest/v1/${path}`, { method, token, body, headers });
}

export function signOutEverywhere(token) {
  return send('/auth/v1/logout?scope=global', { method: 'POST', token, body: {} });
}

// ---- forging ----

const b64 = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');

export function decodeToken(token) {
  const [head, payload] = token.split('.');
  return {
    head: JSON.parse(Buffer.from(head, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
  };
}

/** The token's own header and signature with a CHANGED payload: what a client can do without the signing secret. */
export function withPayload(token, patch) {
  const [head, , signature] = token.split('.');
  const { payload } = decodeToken(token);
  return `${head}.${b64({ ...payload, ...patch })}.${signature}`;
}

/** A token signed with a secret that is NOT the stack's. */
export function signedWithWrongSecret(token, patch = {}) {
  const { head, payload } = decodeToken(token);
  const body = `${b64(head)}.${b64({ ...payload, ...patch })}`;
  return `${body}.${createHmac('sha256', 'not-the-stacks-secret-at-all-0123456789').update(body).digest('base64url')}`;
}

/** An unsigned token ({"alg":"none"}) claiming to be the admin at aal2. */
export function unsigned(token, patch = {}) {
  const { payload } = decodeToken(token);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...payload, ...patch })}.`;
}

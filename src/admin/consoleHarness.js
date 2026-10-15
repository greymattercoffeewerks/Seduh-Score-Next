// Shared by the console's flow tests: a fake Supabase client that keeps one piece of state (who is signed in,
// at which level) so a sign-in, a verified code or a sign-out genuinely changes the next answer, as it does on
// the real server, and helpers to boot the console against it. Not a test file itself.
import { vi } from 'vitest';
import { mountAdminConsole } from './console.js';

export const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

export function makeClient({
  isAdmin = true,
  aal = 'aal1',
  hasFactor = true,
  signedIn = false,
  gate = null,
  verifyError = null,
  signInError = null,
  signOutError = null,
  revokeError = null,
} = {}) {
  const state = { signedIn, aal, hasFactor, stale: [] };
  const client = {
    state,
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: state.signedIn
            ? { access_token: 'token-1', user: { email: 'ops@example.test' } }
            : null,
        },
        error: null,
      })),
      // The server-side revocation a retried sign-out uses (gate.js signOut).
      admin: {
        signOut: vi.fn(async () => {
          if (revokeError) return { data: null, error: revokeError };
          state.revoked = true;
          return { data: null, error: null };
        }),
      },
      signInWithPassword: vi.fn(async () => {
        if (signInError) return { error: signInError };
        state.signedIn = true;
        return { error: null };
      }),
      signOut: vi.fn(async ({ scope }) => {
        // auth-js drops the LOCAL session even when the logout request fails.
        if (signOutError) {
          state.signedIn = false;
          return { error: signOutError };
        }
        state.signedIn = false;
        state.aal = 'aal1';
        state.lastScope = scope;
        return { error: null };
      }),
      mfa: {
        listFactors: vi.fn(async () => ({
          data: {
            totp: state.hasFactor ? [{ id: 'factor-1', status: 'verified' }] : [],
            all: [
              ...(state.hasFactor
                ? [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }]
                : []),
              ...state.stale,
            ],
          },
          error: null,
        })),
        unenroll: vi.fn(async ({ factorId }) => {
          state.stale = state.stale.filter((f) => f.id !== factorId);
          return { error: null };
        }),
        enroll: vi.fn(async () => ({
          data: {
            id: 'factor-new',
            totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEFGHIJKLMNOP' },
          },
          error: null,
        })),
        challengeAndVerify: vi.fn(async () => {
          if (verifyError) return { error: verifyError };
          state.aal = 'aal2';
          state.hasFactor = true;
          return { error: null };
        }),
      },
    },
    rpc: vi.fn(async (name) => {
      if (name === 'am_i_platform_admin') {
        return { data: { is_admin: isAdmin, aal: state.aal }, error: null };
      }
      if (name === 'admin_can_provision') {
        if (gate) return gate(state);
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }),
  };
  return client;
}

const mounted = [];
export function boot(client, options = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = mountAdminConsole(root, { client, ...options });
  mounted.push({ root, handle });
  return root;
}

export const lastHandle = () => mounted.at(-1).handle;

export const button = (root, label) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label);

export function cleanup() {
  for (const { root, handle } of mounted.splice(0)) {
    handle.unmount();
    root.remove();
  }
  window.location.hash = '';
}

export const heading = (root) => root.querySelector('h1')?.textContent;
export const field = (root, name) => root.querySelector(`[data-field="${name}"]`);

export async function type(root, name, value) {
  const input = field(root, name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function submit(root) {
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
}

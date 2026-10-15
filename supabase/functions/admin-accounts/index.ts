// Entry point for the `admin-accounts` Edge Function: wires the real Supabase clients into handler.js, which holds
// all the logic (and is what the tests drive). Keep this file thin.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')!;

Deno.serve((request: Request) =>
  handleRequest(request, {
    // Acts as the caller: their Authorization header is forwarded, so auth.jwt() inside the database carries
    // THEIR aal and amr claims and app.require_platform_admin() judges them, not this function.
    createUserClient: (authorization: string) =>
      createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    // The service role: created only after the platform-admin check passed.
    createAdminClient: () =>
      createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    randomBytes: (count: number) => crypto.getRandomValues(new Uint8Array(count)),
    // Ids and codes only (the handler never passes a password, an email or an Auth error message).
    log: (level: string, event: string, fields: Record<string, unknown>) =>
      console[level === 'error' ? 'error' : 'log'](JSON.stringify({ ...fields, level, event })),
  }),
);

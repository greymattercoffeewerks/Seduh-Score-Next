// Entry point for the `team-accounts` Edge Function: wires the real Supabase clients into
// handler.js, which holds all the logic (and is what the tests drive). Keep this file thin.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')!;

Deno.serve((request: Request) =>
  handleRequest(request, {
    // Acts as the caller: their Authorization header is forwarded, so auth.uid() inside the
    // database is the caller and RLS / the owner check apply to them.
    createUserClient: (authorization: string) =>
      createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    // The service role: only used after the owner check passed.
    createAdminClient: () =>
      createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    randomBytes: (count: number) => crypto.getRandomValues(new Uint8Array(count)),
  }),
);

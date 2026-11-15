// Entry point for the `seduh-claim` Edge Function: wires the real Supabase clients into handler.js, which holds all the
// logic (and is what the tests drive). Keep this file thin.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRequest } from './handler.js';

const url = Deno.env.get('SUPABASE_URL')!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve((request: Request) =>
  handleRequest(request, {
    // The service role: seduh_claim_begin is executable by it alone, and only it can create a login.
    createAdminClient: () => createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, options),
    // The anon key, a fresh client per request: signInWithOtp (shouldCreateUser: false) emails the code through Auth.
    createOtpClient: () => createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, options),
    log: (level: string, event: string, fields: Record<string, unknown>) =>
      console[level === 'error' ? 'error' : 'log'](JSON.stringify({ ...fields, level, event })),
  }),
);

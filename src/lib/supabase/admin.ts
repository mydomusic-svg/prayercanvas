import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses Row Level Security. Server-only.
 * Use for the render worker and for public share-page lookups by token,
 * where there is no authenticated user session to satisfy RLS policies.
 *
 * Never import this into a Client Component or expose the service role key
 * to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

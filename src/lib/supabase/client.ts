import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for use in Client Components ("use client").
 * Reads the public URL + anon key, safe to expose to the browser.
 *
 * Memoized as a module-level singleton. Every "use client" file that needs
 * Supabase calls this same function (account-menu, create/page, prayer-grid,
 * render-status, etc.), and several of them mount at once on a single page
 * (e.g. the dashboard renders both PrayerGrid and AccountMenu together).
 * Without memoizing, each call used to construct a brand new GoTrueClient —
 * every one independently holding its own auto-refresh timer but all
 * reading/writing the SAME auth cookies. That's Supabase's documented
 * "Multiple GoTrueClient instances" pitfall, and it's a likely cause of
 * spurious sign-outs on mobile: when the OS resumes a backgrounded tab (e.g.
 * right after the phone unlocks), several components remount/re-run their
 * effects at nearly the same instant, so several separate clients could all
 * decide the token needs refreshing and race to do it concurrently. Since
 * Supabase refresh tokens are single-use, whichever request loses that race
 * gets an "already used" error, which can invalidate the whole session.
 * A single shared client serializes refreshes through one instance instead.
 */
let browserClient: SupabaseClient | undefined;

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browserClient;
}

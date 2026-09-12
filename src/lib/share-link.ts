import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The public URL for a prayer, creating the share link if it does not exist.
 *
 * REUSED, NOT MINTED EACH TIME. The Share button used to insert a fresh row
 * on every press, so one prayer sent to three people produced three tokens
 * and three separate view counts, none of which told you how many people
 * had actually watched it. A prayer has one public address; this returns
 * that address, and only creates one the first time.
 *
 * An expired link is not reused — it would 404 the moment someone opened
 * it — so a new one is issued instead.
 */
export async function getOrCreateShareUrl(
  supabase: SupabaseClient,
  prayerId: string
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("share_links")
    .select("token, expires_at")
    .eq("prayer_id", prayerId)
    .order("created_at", { ascending: false })
    .limit(5);

  const live = (existing ?? []).find(
    (row) => !row.expires_at || new Date(row.expires_at as string) > new Date()
  );
  if (live?.token) return shareUrlFor(live.token as string);

  const { data: created, error } = await supabase
    .from("share_links")
    .insert({ prayer_id: prayerId })
    .select("token")
    .single();
  if (error || !created?.token) return null;
  return shareUrlFor(created.token as string);
}

/** Built from the current origin so it follows whatever domain the user is on. */
export function shareUrlFor(token: string): string {
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/p/${token}`;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Permanently deletes the signed-in user's account: every prayer's Storage
 * files (audio/video/thumbnail), all their DB rows, and the auth user
 * itself. There's no client-side "delete my own auth user" API — Supabase
 * only exposes that via the service-role admin API — so this has to be a
 * server route.
 *
 * Deletion order matters: Storage files first (they're not touched by the
 * `prayers` cascade), then the auth user last. If the auth user were
 * deleted first and something below failed, we'd be left with orphaned
 * data nobody could ever clean up again since the owning account is gone.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const { data: prayers, error: prayersError } = await admin
      .from("prayers")
      .select("id")
      .eq("user_id", user.id);

    if (prayersError) throw prayersError;

    for (const bucket of ["prayer-audio", "prayer-videos"]) {
      for (const prayer of prayers ?? []) {
        const { data: files } = await admin.storage
          .from(bucket)
          .list(`${user.id}/${prayer.id}`);
        if (files && files.length > 0) {
          await admin.storage
            .from(bucket)
            .remove(files.map((f) => `${user.id}/${prayer.id}/${f.name}`));
        }
      }
    }

    // Cascades to render_jobs / media_assets / share_links.
    const { error: deleteRowsError } = await admin
      .from("prayers")
      .delete()
      .eq("user_id", user.id);
    if (deleteRowsError) throw deleteRowsError;

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw deleteUserError;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Account deletion failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Account deletion failed" },
      { status: 500 }
    );
  }
}

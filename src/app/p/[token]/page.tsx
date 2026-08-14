import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function SharedPrayerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: shareLink } = await supabase
    .from("share_links")
    .select("*, prayers(*)")
    .eq("token", token)
    .maybeSingle();

  if (!shareLink || !shareLink.prayers) notFound();
  if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
    notFound();
  }

  // Best-effort view count increment.
  await supabase
    .from("share_links")
    .update({ view_count: shareLink.view_count + 1 })
    .eq("id", shareLink.id);

  const { data: renderJob } = await supabase
    .from("render_jobs")
    .select("output_url, thumbnail_url, status")
    .eq("prayer_id", shareLink.prayer_id)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prayer = shareLink.prayers as {
    title: string | null;
    recipient_name: string | null;
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-2xl font-semibold">
        {prayer.title ||
          (prayer.recipient_name
            ? `A Prayer for ${prayer.recipient_name}`
            : "A Prayer")}
      </h1>

      {renderJob?.output_url ? (
        <video
          src={renderJob.output_url}
          poster={renderJob.thumbnail_url ?? undefined}
          controls
          autoPlay
          className="w-full rounded-xl"
        />
      ) : (
        <p className="text-neutral-500">This prayer is still being prepared.</p>
      )}

      <p className="text-sm text-neutral-400">Made with PrayerCanvas</p>
    </main>
  );
}

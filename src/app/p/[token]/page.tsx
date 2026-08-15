import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import HeroBanner from "../../hero-banner";

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
    <>
      <HeroBanner variant="slim" />
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-2xl font-semibold">
        {prayer.title ||
          (prayer.recipient_name
            ? `A Prayer for ${prayer.recipient_name}`
            : "A Prayer")}
      </h1>

      {renderJob?.output_url ? (
        // No autoPlay: mobile browsers block autoplay-with-sound outright,
        // so it would either silently do nothing or (worse, without
        // `muted`) just never start — controls alone are more predictable
        // everywhere. playsInline is required on iOS Safari specifically;
        // without it, tapping play forces the video into iOS's fullscreen
        // native player instead of playing in the page.
        <video
          src={renderJob.output_url}
          poster={renderJob.thumbnail_url ?? undefined}
          controls
          playsInline
          className="w-full rounded-xl"
        />
      ) : (
        <p className="text-sage-500">This prayer is still being prepared.</p>
      )}

      <p className="text-sm text-sage-400">Made with PrayerMessenger</p>
      </main>
    </>
  );
}

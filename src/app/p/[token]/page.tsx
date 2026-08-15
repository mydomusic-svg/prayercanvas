import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import HeroBanner from "../../hero-banner";
import PrayerVideoPlayer from "../../prayer-video-player";

export default async function SharedPrayerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: shareLink } = await supabase
    .from("share_links")
    .select("*, prayers(title, recipient_name, transcript)")
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
    transcript: string | null;
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
        // native player instead of playing in the page. The poster image
        // (render_jobs.thumbnail_url) is generated once per render and
        // reused for every viewer of this link — it already has the title
        // and full prayer text composited onto it (see worker/index.js
        // generateThumbnail), so anyone opening the link sees the prayer
        // text at rest, before ever pressing play, not just the sender.
        <PrayerVideoPlayer
          src={renderJob.output_url}
          poster={renderJob.thumbnail_url}
        />
      ) : (
        <p className="text-sage-500">This prayer is still being prepared.</p>
      )}

      {prayer.transcript ? (
        // Always-visible text version of the prayer, independent of video
        // playback state — some visitors want to read along or read instead
        // of watching/listening (e.g. quiet environments, hearing
        // difficulty, or just preferring text).
        <p className="w-full whitespace-pre-wrap rounded-lg bg-sage-50 p-4 text-left text-sage-700">
          {prayer.transcript}
        </p>
      ) : null}
      </main>
    </>
  );
}

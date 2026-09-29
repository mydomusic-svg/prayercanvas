import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import HeroBanner from "../../hero-banner";
import PrayerVideoPlayer from "../../prayer-video-player";
import ShareCta from "../../share-cta";
import RememberReferral from "../remember-referral";

export default async function SharedPrayerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: shareLink } = await supabase
    .from("share_links")
    .select(
      "*, prayers(title, recipient_name, include_recipient_in_title, transcript)"
    )
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

  // THE SENDER'S NAME, fetched separately and deliberately so.
  //
  // It could be embedded in the query above, but that query is what decides
  // whether this page exists at all — a null result renders a 404. This
  // page is the app's only warm introduction to a stranger and the whole
  // share loop runs through it, so nothing optional is allowed to sit on
  // the path that can break it. If this fails, the invitation says
  // "Someone" and everything else works exactly as before.
  let senderName: string | null = null;
  try {
    const { data: prayerOwner } = await supabase
      .from("prayers")
      .select("user_id")
      .eq("id", shareLink.prayer_id)
      .maybeSingle();
    if (prayerOwner?.user_id) {
      const { data: sender } = await supabase
        .from("users")
        .select("display_name")
        .eq("id", prayerOwner.user_id)
        .maybeSingle();
      senderName = sender?.display_name ?? null;
    }
  } catch {
    // Name unavailable; the fallback in ShareCta covers it.
  }

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
    include_recipient_in_title: boolean;
    transcript: string | null;
  };

  const displayTitle =
    prayer.title ||
    (prayer.include_recipient_in_title && prayer.recipient_name
      ? `A Prayer for ${prayer.recipient_name}`
      : "A Prayer");

  const hasVideo = Boolean(renderJob?.output_url);

  // Extracted so the two orderings below cannot drift apart. Always
  // visible rather than behind a toggle: some visitors read instead of
  // watching — a quiet room, a hearing difficulty, or simply preferring
  // text.
  const transcriptBlock = prayer.transcript ? (
    <p className="w-full whitespace-pre-wrap rounded-lg bg-sage-50 p-4 text-left text-sage-700">
      {prayer.transcript}
    </p>
  ) : null;

  return (
    <>
      <HeroBanner variant="slim" />
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <RememberReferral token={token} />
      <h1 className="text-2xl font-semibold">{displayTitle}</h1>

      {renderJob?.output_url ? (
        // No autoPlay: mobile browsers block autoplay-with-sound outright,
        // so it would either silently do nothing or (worse, without
        // `muted`) just never start — controls alone are more predictable
        // everywhere. playsInline is required on iOS Safari specifically;
        // without it, tapping play forces the video into iOS's fullscreen
        // native player instead of playing in the page. The poster image
        // (render_jobs.thumbnail_url) is generated once per render and
        // reused for every viewer of this link — it already has the full
        // prayer text composited onto it (see worker/index.js
        // generateThumbnail), so anyone opening the link sees that at rest,
        // before ever pressing play. The title/recipient name IS baked into
        // the video/thumbnail pixels themselves (see worker/index.js) —
        // PrayerVideoPlayer no longer overlays it separately, since that used
        // to draw a second, slightly misaligned copy on top of the first.
        <PrayerVideoPlayer
          src={renderJob.output_url}
          poster={renderJob.thumbnail_url}
          title={displayTitle}
        />
      ) : renderJob ? (
        // THE VIDEO EXPIRED, and this page used to say "still being
        // prepared" — which is untrue, and it is the only page a stranger
        // ever meets this app on. Free-tier videos are swept a week after
        // rendering (runRetentionSweep in the worker), so a prayer sent on a
        // Friday and opened a fortnight later landed here and was told it
        // was still rendering.
        //
        // The words of the prayer are still below, which is the part that
        // was actually sent. Only the video is gone, and saying so plainly
        // is better than a message that makes the app look broken.
        <p className="text-sage-500">
          The video for this prayer is no longer available — but the prayer
          itself is here, below.
        </p>
      ) : (
        <p className="text-sage-500">This prayer is still being prepared.</p>
      )}

      {/* WHERE THE INVITATION SITS DEPENDS ON WHETHER THE VIDEO PLAYED.
          
          Normally it goes directly under the video, above the prayer text.
          It used to sit after the transcript, which put it two screens
          below the fold — the only action on the page, placed where almost
          nobody reached it.

          But when the video has expired, the transcript IS the message,
          not a utility beneath it. Putting the invitation first there
          would pitch the app to someone before letting them read what
          they were actually sent, which is exactly the thing the tone of
          this section is meant to avoid. So in that case the prayer comes
          first and the invitation follows it, as it always did. */}
      {hasVideo ? (
        <>
          <ShareCta senderName={senderName} />
          {transcriptBlock}
        </>
      ) : (
        <>
          {transcriptBlock}
          <ShareCta senderName={senderName} />
        </>
      )}

      </main>
    </>
  );
}

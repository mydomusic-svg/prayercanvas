"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RenderJob } from "@/lib/types";
import ShareButton from "./share-button";
import MediaEditor from "./media-editor";
import PrayerActions from "../../prayer-actions";
import PrayerVideoPlayer from "../../prayer-video-player";

// Polls for render_jobs updates instead of leaving the user staring at a
// static "Queued" message with no way to know when (or whether) their video
// is ready. A render usually takes anywhere from ~20s to a couple of
// minutes, and nothing on this page used to tell the user that — they had
// to manually refresh and guess. This polls every 3s while the job is
// pending/processing and swaps in the finished video (or an error) the
// moment it's done, no refresh needed.
export default function RenderStatus({
  prayerId,
  userId,
  title,
  styleId,
  musicStyleId,
  photoAssetUrl,
  initialJob,
}: {
  prayerId: string;
  userId: string;
  title: string;
  styleId: string | null;
  musicStyleId: string | null;
  photoAssetUrl: string | null;
  initialJob: RenderJob | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [job, setJob] = useState<RenderJob | null>(initialJob);
  // Mirrors the prayer's style_id/music_style_id/photo_asset_url locally so
  // MediaEditor always knows the real "current" values after a swap,
  // without needing a full page reload — see its onRequeued callback below.
  const [media, setMedia] = useState({ styleId, musicStyleId, photoAssetUrl });
  const pollCountRef = useRef(0);

  const isSettled = job?.status === "complete" || job?.status === "failed";

  useEffect(() => {
    if (isSettled) return;

    const interval = setInterval(async () => {
      pollCountRef.current += 1;

      const { data } = await supabase
        .from("render_jobs")
        .select("*")
        .eq("prayer_id", prayerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) setJob(data as RenderJob);
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettled, prayerId]);

  if (!job) {
    return <p className="text-sage-500">No render job yet.</p>;
  }

  if (job.status === "complete" && job.output_url) {
    return (
      <div className="mt-3 flex flex-col gap-3">
        <PrayerVideoPlayer
          src={job.output_url}
          poster={job.thumbnail_url}
          title={title}
        />
        <div className="flex flex-wrap items-center gap-2">
          <PrayerActions
            prayerId={prayerId}
            userId={userId}
            videoUrl={job.output_url}
            title={title}
            onDeleted={() => router.push("/dashboard")}
          />
          <ShareButton prayerId={prayerId} />
        </div>
        <MediaEditor
          prayerId={prayerId}
          userId={userId}
          currentStyleId={media.styleId}
          currentMusicStyleId={media.musicStyleId}
          currentPhotoAssetUrl={media.photoAssetUrl}
          onRequeued={(newJob, newMedia) => {
            setJob(newJob);
            setMedia(newMedia);
          }}
        />
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-red-600">Render failed: {job.error ?? "Unknown error"}</p>
        <PrayerActions
          prayerId={prayerId}
          userId={userId}
          videoUrl={null}
          title={title}
          onDeleted={() => router.push("/dashboard")}
        />
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2 text-sage-500">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-sage-300 border-t-sage-700"
      />
      <p>
        {job.status === "processing"
          ? `Rendering… (${job.progress}%) — this page will update automatically.`
          : "Queued — the render worker will pick this up shortly. This page will update automatically."}
      </p>
    </div>
  );
}

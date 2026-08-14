"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Shared Download / Share / Delete controls for a rendered prayer video —
// used on both the dashboard library cards and the prayer detail page so
// the behavior (and the storage cleanup on delete) only lives in one place.
export default function PrayerActions({
  prayerId,
  userId,
  videoUrl,
  title,
  onDeleted,
  compact = false,
}: {
  prayerId: string;
  userId: string;
  videoUrl: string | null;
  title: string;
  onDeleted?: () => void;
  compact?: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied" | "error">("idle");

  const fileName = `${(title || "prayer").replace(/[^\w\- ]+/g, "").trim() || "prayer"}.mp4`;

  async function fetchVideoFile(): Promise<File | null> {
    if (!videoUrl) return null;
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], fileName, { type: blob.type || "video/mp4" });
  }

  async function handleDownload() {
    if (!videoUrl) return;
    setDownloading(true);
    try {
      const file = await fetchVideoFile();
      if (!file) throw new Error("Couldn't fetch video");
      const objectUrl = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Fall back to just opening the video — the user can save it from
      // there (e.g. long-press > Save Video on mobile) even if the fetch
      // above got blocked for some reason.
      window.open(videoUrl, "_blank");
    } finally {
      setDownloading(false);
    }
  }

  // Uses the phone/browser's native share sheet — the same one that pops
  // up sharing a photo from the camera roll — so the user can pick
  // Messages, Mail, Instagram, WhatsApp, etc. themselves without us
  // needing a separate integration per app.
  async function handleShare() {
    if (!videoUrl) return;
    setSharing(true);
    setShareState("idle");
    try {
      const shareData: ShareData = { title: title || "My Prayer" };

      if (navigator.canShare) {
        const file = await fetchVideoFile();
        if (file && navigator.canShare({ files: [file] })) {
          await navigator.share({ ...shareData, files: [file] });
          return;
        }
      }

      if (navigator.share) {
        await navigator.share({ ...shareData, url: videoUrl });
        return;
      }

      await navigator.clipboard.writeText(videoUrl);
      setShareState("copied");
    } catch (err) {
      // AbortError just means the user closed the share sheet — not an error.
      if (err instanceof Error && err.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(videoUrl);
        setShareState("copied");
      } catch {
        setShareState("error");
      }
    } finally {
      setSharing(false);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        "Delete this prayer and its video? This can't be undone."
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      // Best-effort storage cleanup — objects live under `${userId}/${prayerId}/`
      // in both buckets. If this fails partway the DB delete below still
      // proceeds; a stray file left in storage is harmless, an undeletable
      // prayer row is not.
      for (const bucket of ["prayer-audio", "prayer-videos"]) {
        const { data: files } = await supabase.storage
          .from(bucket)
          .list(`${userId}/${prayerId}`);
        if (files && files.length > 0) {
          await supabase.storage
            .from(bucket)
            .remove(files.map((f) => `${userId}/${prayerId}/${f.name}`));
        }
      }

      const { error } = await supabase.from("prayers").delete().eq("id", prayerId);
      if (error) throw error;

      if (onDeleted) {
        onDeleted();
      } else {
        router.refresh();
      }
    } catch {
      alert("Something went wrong deleting this prayer. Try again in a moment.");
    } finally {
      setDeleting(false);
    }
  }

  const btnClass = compact
    ? "rounded-full border border-sage-300 px-3 py-1 text-xs text-sage-600 transition hover:bg-sage-50 disabled:opacity-50"
    : "rounded-full border border-sage-300 px-4 py-1.5 text-sm text-sage-700 transition hover:bg-sage-50 disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {videoUrl && (
        <>
          <button onClick={handleDownload} disabled={downloading} className={btnClass}>
            {downloading ? "Downloading…" : "Download"}
          </button>
          <button onClick={handleShare} disabled={sharing} className={btnClass}>
            {sharing
              ? "Sharing…"
              : shareState === "copied"
                ? "Link copied!"
                : "Share"}
          </button>
        </>
      )}
      <button
        onClick={handleDelete}
        disabled={deleting}
        className={`${btnClass} !border-red-200 !text-red-600 hover:!bg-red-50`}
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
      {shareState === "error" && (
        <p className="w-full text-xs text-red-600">
          Couldn&apos;t share or copy the link — try downloading instead.
        </p>
      )}
    </div>
  );
}

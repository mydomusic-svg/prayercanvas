"use client";

import { useState } from "react";
import Link from "next/link";
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
  // Free plan gets a limited number of downloads per rolling 24 hours (see
  // /api/prayers/[id]/download). null means unlimited or not yet known.
  const [downloadsLeft, setDownloadsLeft] = useState<number | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied" | "error">("idle");

  // iPadOS reports itself as a Mac, so the touch-point check is what
  // separates an iPad from a desktop Safari. Used only to pick the download
  // strategy below — nothing about the UI branches on this.
  function isIos() {
    if (typeof navigator === "undefined") return false;
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  }

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
    setLimitHit(false);
    try {
      // Ask the server to spend one of the free plan's daily downloads
      // BEFORE fetching the file, so the count reflects downloads actually
      // granted. Paid plans always come back allowed. A network failure
      // here is deliberately non-blocking (see the catch below): being
      // unable to reach the quota endpoint should not stop someone saving
      // their own prayer.
      let allowed = true;
      try {
        const res = await fetch(`/api/prayers/${prayerId}/download`, {
          method: "POST",
        });
        if (res.status === 429) {
          allowed = false;
          const body = await res.json().catch(() => null);
          setDownloadsLeft(body?.remaining ?? 0);
        } else if (res.ok) {
          const body = await res.json().catch(() => null);
          setDownloadsLeft(
            body?.unlimited ? null : (body?.remaining ?? null)
          );
        }
      } catch {
        // Quota endpoint unreachable — fail open rather than trap the user.
      }

      if (!allowed) {
        setLimitHit(true);
        return;
      }

      const file = await fetchVideoFile();
      if (!file) throw new Error("Couldn't fetch video");

      // iOS SAFARI DOES NOT SUPPORT <a download>.
      //
      // The attribute exists on the element, so feature detection cannot
      // see the problem — Safari simply ignores it and no file is saved.
      // Worse, it does not throw, so the catch below never fired: on an
      // iPhone this whole branch used to silently do nothing while still
      // having spent one of the three daily free downloads above. Tap
      // Download, lose a download, get no video.
      //
      // The share sheet is the real "save a file" path on iOS: for an mp4
      // it offers Save Video (straight to Photos) and Save to Files. So on
      // iOS that is the download, and it is a better result than a file in
      // the Downloads folder anyway.
      if (isIos() && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: title || "My Prayer", files: [file] });
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking synchronously can cancel a download that has not actually
      // started yet — the click only queues it. One tick is enough.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
      // The user closing the iOS share sheet is a cancellation, not a
      // failure — opening the video in a new tab on top of it would be
      // obnoxious.
      if (err instanceof Error && err.name === "AbortError") return;
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
      {limitHit ? (
        <p className="w-full text-xs text-sage-700">
          You&apos;ve used your 3 free downloads for today.{" "}
          <Link href="/pricing" className="underline">
            Upgrade for unlimited downloads
          </Link>{" "}
          — or try again tomorrow.
        </p>
      ) : (
        // Only worth showing once they're actually close to the cap —
        // "3 left" on every card is noise, "1 left" is useful.
        downloadsLeft !== null &&
        downloadsLeft <= 1 && (
          <p className="w-full text-xs text-sage-500">
            {downloadsLeft === 0
              ? "That was your last free download today."
              : "1 free download left today."}
          </p>
        )
      )}
    </div>
  );
}

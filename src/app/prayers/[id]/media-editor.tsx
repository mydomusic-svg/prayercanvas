"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MusicStyle, PhotoStyle, RenderJob, Style } from "@/lib/types";

// Lets the owner swap the background or music on an already-rendered prayer
// without re-recording or re-transcribing anything. A full "regenerate"
// (record → upload → transcribe → AI title/theme → render) is by far the
// most expensive part of creating a prayer; picking a different background
// clip or music bed doesn't need any of that, since the transcript,
// captions, word timings, and title are all still sitting in the `prayers`
// row from the first render. This just updates style_id/music_style_id (or
// uploads a new photo) and queues a fresh render_jobs row — the worker
// re-runs its ffmpeg pass against the existing audio/transcript, which
// takes anywhere from a few seconds to under a minute depending on clip
// length, versus the full pipeline which also has to wait on Whisper +
// Claude. It's not a zero-cost swap (the video file itself has to be
// re-encoded either way, since the background/music are literally
// composited into the output — see worker/index.js), just a much cheaper
// one than starting over.
export default function MediaEditor({
  prayerId,
  userId,
  currentStyleId,
  currentMusicStyleId,
  currentPhotoAssetUrl,
  onRequeued,
}: {
  prayerId: string;
  userId: string;
  currentStyleId: string | null;
  currentMusicStyleId: string | null;
  currentPhotoAssetUrl: string | null;
  onRequeued: (
    job: RenderJob,
    media: { styleId: string | null; musicStyleId: string | null; photoAssetUrl: string | null }
  ) => void;
}) {
  const supabase = createClient();

  const [expanded, setExpanded] = useState(false);
  const [styles, setStyles] = useState<Style[]>([]);
  const [musicStyles, setMusicStyles] = useState<MusicStyle[]>([]);
  const [photoStyles, setPhotoStyles] = useState<PhotoStyle[]>([]);
  const [loaded, setLoaded] = useState(false);

  // "background mode" mirrors create/page.tsx: a library style (picked by
  // category, specific clip randomized at submit), a user-uploaded photo,
  // or a curated library photo. Seeded from whatever the prayer currently
  // has so opening this panel doesn't look like it reset your choice — see
  // the photoStyles-lookup effect below, which resolves "photo" into
  // "upload" vs "libraryPhoto" once the library has loaded (a plain
  // currentPhotoAssetUrl alone can't tell the two apart).
  const [backgroundMode, setBackgroundMode] = useState<
    "library" | "upload" | "libraryPhoto"
  >(currentPhotoAssetUrl ? "upload" : "library");
  const [selectedStyleCategory, setSelectedStyleCategory] = useState<string | null>(
    null
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [libraryPhotoUrl, setLibraryPhotoUrl] = useState<string | null>(null);
  const [photoLibraryOpen, setPhotoLibraryOpen] = useState(false);
  const [photoCategory, setPhotoCategory] = useState<string | null>(null);

  const [selectedMusicStyleId, setSelectedMusicStyleId] = useState<string | null>(
    currentMusicStyleId
  );
  const [musicCategory, setMusicCategory] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || loaded) return;
    Promise.all([
      supabase
        .from("styles")
        .select("id, name, visual_asset, music_asset, caption_template, category, source, license")
        .order("category", { ascending: true }),
      supabase
        .from("music_styles")
        .select("id, name, music_asset, category, source, license")
        .order("category", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("photo_styles")
        .select("id, name, image_asset, category, source, license")
        .order("category", { ascending: true })
        .order("created_at", { ascending: true }),
    ]).then(([stylesRes, musicRes, photoRes]) => {
      const fetchedStyles = (stylesRes.data as Style[] | null) ?? [];
      const fetchedMusic = (musicRes.data as MusicStyle[] | null) ?? [];
      const fetchedPhotos = (photoRes.data as PhotoStyle[] | null) ?? [];
      setStyles(fetchedStyles);
      setMusicStyles(fetchedMusic);
      setPhotoStyles(fetchedPhotos);

      const currentStyle = fetchedStyles.find((s) => s.id === currentStyleId);
      setSelectedStyleCategory(
        currentStyle?.category ?? fetchedStyles[0]?.category ?? null
      );

      const currentMusic = fetchedMusic.find((m) => m.id === currentMusicStyleId);
      setMusicCategory(currentMusic?.category ?? fetchedMusic[0]?.category ?? null);

      // A plain photo_asset_url can't tell an uploaded photo apart from a
      // library one — check whether it matches a known library photo.
      if (currentPhotoAssetUrl) {
        const matchingLibraryPhoto = fetchedPhotos.find(
          (p) => p.image_asset === currentPhotoAssetUrl
        );
        if (matchingLibraryPhoto) {
          setBackgroundMode("libraryPhoto");
          setLibraryPhotoUrl(matchingLibraryPhoto.image_asset);
          setPhotoCategory(matchingLibraryPhoto.category ?? null);
        } else {
          setBackgroundMode("upload");
        }
      }

      setLoaded(true);
    });
  }, [expanded, loaded, supabase, currentStyleId, currentMusicStyleId, currentPhotoAssetUrl]);

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setBackgroundMode("upload");
    setLibraryPhotoUrl(null);
  }

  function selectLibraryPhoto(url: string) {
    setLibraryPhotoUrl(url);
    setBackgroundMode("libraryPhoto");
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
  }

  function selectStyleCategory(category: string) {
    setBackgroundMode("library");
    setSelectedStyleCategory(category);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setLibraryPhotoUrl(null);
  }

  function pickRandomStyleId(category: string | null): string | null {
    if (styles.length === 0) return null;
    const pool = category
      ? styles.filter((s) => (s.category || "Other") === category)
      : styles;
    const options = pool.length > 0 ? pool : styles;
    return options[Math.floor(Math.random() * options.length)].id;
  }

  // What mode the prayer is ACTUALLY in right now, independent of whatever
  // the user has clicked around to in this panel — resolved once the photo
  // library has loaded (see the effect above) and otherwise unchanged.
  const initialMode: "library" | "upload" | "libraryPhoto" = !currentPhotoAssetUrl
    ? "library"
    : photoStyles.some((p) => p.image_asset === currentPhotoAssetUrl)
      ? "libraryPhoto"
      : "upload";

  const musicChanged = selectedMusicStyleId !== currentMusicStyleId;
  const backgroundChanged =
    backgroundMode !== initialMode
      ? true
      : backgroundMode === "library"
        ? selectedStyleCategory !==
          (styles.find((s) => s.id === currentStyleId)?.category ?? null)
        : backgroundMode === "upload"
          ? Boolean(photoFile) // only a genuinely new upload counts as a change
          : libraryPhotoUrl !== currentPhotoAssetUrl;
  const hasChanges = musicChanged || backgroundChanged;

  async function handleUpdate() {
    if (!hasChanges) return;
    setSubmitting(true);
    setError(null);
    try {
      const updates: Record<string, string | null> = {};
      // Resolved end-state, reported back to the parent below regardless of
      // which individual fields actually changed, so it can keep its
      // "current" values in sync without needing a full page reload.
      let finalStyleId = currentStyleId;
      let finalMusicStyleId = currentMusicStyleId;
      let finalPhotoAssetUrl = currentPhotoAssetUrl;

      if (musicChanged) {
        updates.music_style_id = selectedMusicStyleId;
        finalMusicStyleId = selectedMusicStyleId;
      }

      if (backgroundChanged) {
        if (backgroundMode === "upload") {
          if (photoFile) {
            const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
            const photoPath = `${userId}/${prayerId}/photo.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from("prayer-photos")
              .upload(photoPath, photoFile, {
                contentType: photoFile.type || "image/jpeg",
                upsert: true,
              });
            if (uploadError) throw uploadError;

            const { data: publicUrl } = supabase.storage
              .from("prayer-photos")
              .getPublicUrl(photoPath);
            updates.photo_asset_url = publicUrl.publicUrl;
            finalPhotoAssetUrl = publicUrl.publicUrl;
          }
          updates.style_id = null;
          finalStyleId = null;
        } else if (backgroundMode === "libraryPhoto") {
          // Already hosted in our own Storage bucket — no upload needed,
          // just point the prayer at it directly.
          updates.photo_asset_url = libraryPhotoUrl;
          updates.style_id = null;
          finalPhotoAssetUrl = libraryPhotoUrl;
          finalStyleId = null;
        } else {
          const newStyleId = pickRandomStyleId(selectedStyleCategory);
          updates.style_id = newStyleId;
          updates.photo_asset_url = null;
          finalStyleId = newStyleId;
          finalPhotoAssetUrl = null;
        }
      }

      const { error: updateError } = await supabase
        .from("prayers")
        .update(updates)
        .eq("id", prayerId);
      if (updateError) throw updateError;

      // Only style/music/photo changed — transcript, captions, word timings,
      // and title are untouched, so the worker's re-render doesn't need
      // transcription or AI analysis again, just a fresh ffmpeg pass.
      const { data: newJob, error: jobError } = await supabase
        .from("render_jobs")
        .insert({ prayer_id: prayerId, status: "pending" })
        .select()
        .single();
      if (jobError || !newJob) throw jobError;

      onRequeued(newJob as RenderJob, {
        styleId: finalStyleId,
        musicStyleId: finalMusicStyleId,
        photoAssetUrl: finalPhotoAssetUrl,
      });
      setExpanded(false);
      setPhotoFile(null);
      setPhotoPreviewUrl(null);
    } catch {
      setError("Couldn't update the video. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="self-start rounded-full border border-sage-300 px-4 py-1.5 text-sm text-sage-700 transition hover:bg-sage-50"
      >
        Change music or background
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-sage-200 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Change music or background</p>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-sage-500 underline"
        >
          Close
        </button>
      </div>

      {!loaded ? (
        <p className="text-sm text-sage-500">Loading options…</p>
      ) : (
        <>
          <p className="text-xs text-sage-500">
            This re-renders the video with your existing recording and
            captions — no need to record again, just a fresh render with the
            new background/music (usually well under a minute).
          </p>

          {styles.length > 0 && (() => {
            const categories = Array.from(
              new Set(styles.map((s) => s.category || "Other"))
            );
            return (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-sage-600">Background</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <label
                    className={`flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-2 py-3 text-center text-xs transition ${
                      backgroundMode === "upload"
                        ? "border-sage-600 bg-sage-600 text-white"
                        : "border-dashed border-sage-400 text-sage-600 hover:bg-sage-50"
                    }`}
                  >
                    {photoPreviewUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                        <img
                          src={photoPreviewUrl}
                          alt=""
                          className="h-12 w-12 rounded object-cover"
                        />
                        <span>New photo (tap to change)</span>
                      </>
                    ) : backgroundMode === "upload" && currentPhotoAssetUrl ? (
                      <span>📷 Current photo (tap to replace)</span>
                    ) : (
                      <span>📷 Upload a photo</span>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                  {photoStyles.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPhotoLibraryOpen((v) => !v)}
                      className={`flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-2 py-3 text-center text-xs transition ${
                        backgroundMode === "libraryPhoto"
                          ? "border-sage-600 bg-sage-600 text-white"
                          : "border-dashed border-sage-400 text-sage-600 hover:bg-sage-50"
                      }`}
                    >
                      {backgroundMode === "libraryPhoto" && libraryPhotoUrl ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail */}
                          <img
                            src={libraryPhotoUrl}
                            alt=""
                            className="h-12 w-12 rounded object-cover"
                          />
                          <span>Library photo (tap to change)</span>
                        </>
                      ) : (
                        <span>🖼️ Photo library</span>
                      )}
                    </button>
                  )}
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => selectStyleCategory(cat)}
                      className={`rounded-lg border px-3 py-3 text-xs transition ${
                        backgroundMode === "library" && selectedStyleCategory === cat
                          ? "border-sage-600 bg-sage-600 text-white"
                          : "border-sage-300 hover:bg-sage-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                {backgroundMode === "library" && (
                  <p className="text-xs text-sage-400">
                    Picks a random new clip from that category — the exact
                    clip isn&apos;t chosen until you hit update.
                  </p>
                )}
                {photoLibraryOpen && photoStyles.length > 0 && (() => {
                  const photoCategories = Array.from(
                    new Set(photoStyles.map((p) => p.category || "Other"))
                  );
                  const visiblePhotos = photoCategory
                    ? photoStyles.filter((p) => (p.category || "Other") === photoCategory)
                    : photoStyles;
                  return (
                    <div className="flex flex-col gap-2 rounded-lg border border-sage-200 p-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setPhotoCategory(null)}
                          className={`rounded-full border px-3 py-1 text-xs transition ${
                            photoCategory === null
                              ? "border-sage-600 bg-sage-600 text-white"
                              : "border-sage-300 text-sage-600 hover:bg-sage-50"
                          }`}
                        >
                          All
                        </button>
                        {photoCategories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setPhotoCategory(cat)}
                            className={`rounded-full border px-3 py-1 text-xs transition ${
                              photoCategory === cat
                                ? "border-sage-600 bg-sage-600 text-white"
                                : "border-sage-300 text-sage-600 hover:bg-sage-50"
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                        {visiblePhotos.map((photo) => (
                          <button
                            key={photo.id}
                            type="button"
                            onClick={() => {
                              selectLibraryPhoto(photo.image_asset);
                              setPhotoLibraryOpen(false);
                            }}
                            className={`overflow-hidden rounded-lg border-2 transition ${
                              libraryPhotoUrl === photo.image_asset
                                ? "border-sage-600"
                                : "border-transparent hover:border-sage-300"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail grid */}
                            <img
                              src={photo.image_asset}
                              alt={photo.name}
                              className="aspect-[9/16] w-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {musicStyles.length > 0 && (() => {
            const categories = Array.from(
              new Set(musicStyles.map((m) => m.category || "Other"))
            );
            const visible = musicCategory
              ? musicStyles.filter((m) => (m.category || "Other") === musicCategory)
              : musicStyles;
            return (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-sage-600">Music</p>
                {categories.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setMusicCategory(cat)}
                        className={`rounded-full border px-3 py-1 text-xs transition ${
                          musicCategory === cat
                            ? "border-sage-600 bg-sage-600 text-white"
                            : "border-sage-300 text-sage-600 hover:bg-sage-50"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {visible.map((musicStyle) => (
                    <button
                      key={musicStyle.id}
                      type="button"
                      onClick={() => setSelectedMusicStyleId(musicStyle.id)}
                      className={`rounded-lg border px-3 py-2 text-xs transition ${
                        selectedMusicStyleId === musicStyle.id
                          ? "border-sage-600 bg-sage-600 text-white"
                          : "border-sage-300 hover:bg-sage-50"
                      }`}
                    >
                      {musicStyle.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            type="button"
            onClick={handleUpdate}
            disabled={!hasChanges || submitting}
            className="self-start rounded-full bg-sage-600 px-5 py-2 text-sm text-white transition hover:bg-sage-700 disabled:opacity-50"
          >
            {submitting ? "Updating…" : "Update video"}
          </button>
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import HeroBanner from "../hero-banner";
import type {
  AccentColor,
  CartoonCharacter,
  MusicStyle,
  PhotoStyle,
  Style,
  TextStyle,
} from "@/lib/types";

type RecordingState = "idle" | "recording" | "recorded";

// iOS Safari's MediaRecorder doesn't support webm at all — it records into
// an MP4/AAC container. The old code always requested no mimeType (fine)
// but then unconditionally labeled the resulting Blob (and later the
// Storage upload path, and the Whisper filename) as "audio/webm" /
// "raw.webm" regardless of what was actually recorded. On iPhone that lie
// meant Whisper was handed an MP4 file asserted to be webm, which silently
// produced empty or garbage transcripts. This picks (and remembers) the
// real supported mimeType so the extension used everywhere downstream
// matches the real container.
const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/aac",
];

function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  return RECORDING_MIME_CANDIDATES.find((type) =>
    MediaRecorder.isTypeSupported(type)
  );
}

// Maps a recorded/uploaded audio mimeType to a file extension so the
// Storage path and the Whisper filename hint always match the actual bytes.
function extensionForMimeType(mimeType: string | undefined): string {
  const type = (mimeType || "").toLowerCase();
  if (type.includes("mp4") || type.includes("m4a")) return "mp4";
  if (type.includes("aac")) return "aac";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  return "webm";
}

// Mirrors worker/index.js's TEXT_STYLES — three curated title looks rather
// than an open font picker, so every choice is guaranteed to render well.
const TEXT_STYLE_OPTIONS: {
  id: TextStyle;
  label: string;
  sample: string;
  fontVar: string;
  uppercase?: boolean;
}[] = [
  {
    id: "calligraphy",
    label: "Calligraphy",
    sample: "Grace & Peace",
    fontVar: "var(--font-calligraphy)",
  },
  {
    id: "modern",
    label: "Modern",
    sample: "GRACE & PEACE",
    fontVar: "var(--font-modern)",
    uppercase: true,
  },
  {
    id: "handwritten",
    label: "Handwritten",
    sample: "Grace & Peace",
    fontVar: "var(--font-handwritten)",
  },
];

// Mirrors worker/index.js's ACCENT_COLORS.
const ACCENT_COLOR_OPTIONS: { id: AccentColor; label: string; hex: string }[] = [
  { id: "gold", label: "Gold", hex: "#f5c451" },
  { id: "rose", label: "Rose", hex: "#e98a9c" },
  { id: "sky", label: "Sky", hex: "#8ecae6" },
  { id: "sage", label: "Sage", hex: "#8fbf8f" },
  { id: "ivory", label: "Ivory", hex: "#ffffff" },
];

export default function CreatePrayerPage() {
  const router = useRouter();
  const supabase = createClient();

  const [recipientName, setRecipientName] = useState("");
  // Off by default: most prayers get shared with whoever the user likes, not
  // just the one person named here, and the title/text is burned directly
  // into the rendered video (see worker/index.js) — so an unwanted name in
  // the title means re-rendering to fix it, not just a quick edit. Only
  // opt the name into the title/video when the user explicitly asks for it.
  const [includeRecipientInTitle, setIncludeRecipientInTitle] = useState(false);
  const [occasion, setOccasion] = useState("");
  const [styles, setStyles] = useState<Style[]>([]);
  // The video style picker is category-only now (see selectStyleCategory) —
  // a specific clip within the chosen category is picked at random at
  // submit time (pickRandomStyleId), so the UI never needs to show or track
  // an individual style row's id.
  const [selectedStyleCategory, setSelectedStyleCategory] = useState<
    string | null
  >(null);
  const [musicStyles, setMusicStyles] = useState<MusicStyle[]>([]);
  // Music, like the video style, is chosen by CATEGORY only — the specific
  // track is drawn at random at submit time (pickRandomMusicStyleId), so
  // there is no individual track id for the UI to hold onto.
  const [musicCategory, setMusicCategory] = useState<string | null>(null);
  const [textStyle, setTextStyle] = useState<TextStyle>("calligraphy");
  const [accentColor, setAccentColor] = useState<AccentColor>("gold");

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // A user-uploaded photo is an alternative to picking a library style
  // category — photoFile takes priority at submit time (see handleSubmit)
  // and the worker renders it with a Ken Burns pan/zoom effect instead of
  // using a library video (0012_photo_upload.sql).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  // A second alternative: a curated stock photo instead of an upload (see
  // 0014_photo_styles.sql / scripts/seed-photo-library.mjs). Since these are
  // already hosted in our own Storage bucket, picking one just needs the
  // URL — no upload step at submit time, unlike photoFile.
  const [photoStyles, setPhotoStyles] = useState<PhotoStyle[]>([]);
  const [photoLibraryOpen, setPhotoLibraryOpen] = useState(false);
  const [photoCategory, setPhotoCategory] = useState<string | null>(null);
  const [libraryPhotoUrl, setLibraryPhotoUrl] = useState<string | null>(null);

  // Funny Cartoon category (0015_cartoon_characters.sql): picking a
  // character replaces the normal photo/video style + text-style/accent-
  // color choices below entirely — the render worker shows just the
  // character's portrait with no on-screen prayer text, voiced by an AI TTS
  // track instead of the recording above (which is still needed, since it's
  // how the prayer's actual words get captured/transcribed).
  const [cartoonCharacters, setCartoonCharacters] = useState<CartoonCharacter[]>([]);
  const [cartoonCharacterId, setCartoonCharacterId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    supabase
      .from("styles")
      .select("id, name, visual_asset, music_asset, caption_template, category, source, license")
      .order("category", { ascending: true })
      .then(({ data }) => {
        if (data) {
          setStyles(data as Style[]);
          if (data.length > 0) {
            setSelectedStyleCategory(data[0].category ?? null);
          }
        }
      });
    // Music is chosen independently of the visual style — see
    // supabase/migrations/0010_music_styles.sql.
    supabase
      .from("music_styles")
      .select("id, name, music_asset, category, source, license")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) {
          setMusicStyles(data as MusicStyle[]);
          if (data.length > 0) setMusicCategory(data[0].category ?? null);
        }
      });
    supabase
      .from("photo_styles")
      .select("id, name, image_asset, category, source, license")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setPhotoStyles(data as PhotoStyle[]);
      });
    supabase
      .from("cartoon_characters")
      .select("id, name, image_asset, openai_voice, pitch_ratio, category, source, license")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) setCartoonCharacters(data as CartoonCharacter[]);
      });
  }, [supabase]);

  function selectCartoonCharacter(id: string | null) {
    setCartoonCharacterId(id);
    // A cartoon character replaces the photo/video background entirely —
    // clear any of those choices so submit doesn't end up with both set.
    if (id) {
      setPhotoFile(null);
      setPhotoPreviewUrl(null);
      setLibraryPhotoUrl(null);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // recorder.mimeType reflects what the browser actually used, which
        // may differ slightly from what we requested — prefer it.
        const actualType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: actualType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecordingState("recorded");
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecordingState("recording");
    } catch {
      setError(
        "Couldn't access your microphone. Check your browser permissions, or upload an audio file below instead."
      );
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
    setRecordingState("recorded");
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setLibraryPhotoUrl(null);
  }

  function selectLibraryPhoto(url: string) {
    setLibraryPhotoUrl(url);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
  }

  function selectStyleCategory(category: string) {
    setSelectedStyleCategory(category);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setLibraryPhotoUrl(null);
  }

  // The picker only shows category tiles ("Celebration", "Nature", ...) —
  // not every individual clip in the library — for a clean, simple layout.
  // The actual clip is picked randomly from that category right at submit
  // time, so re-generating (or just creating another prayer with the same
  // category) doesn't always use the exact same background.
  // Same idea as pickRandomStyleId below, for music: the picker only offers
  // categories, so the actual track is chosen here at the last moment. Two
  // prayers made with the same category therefore get different music rather
  // than always the same first track.
  function pickRandomMusicStyleId(category: string | null): string | null {
    if (musicStyles.length === 0) return null;
    const pool = category
      ? musicStyles.filter((m) => (m.category || "Other") === category)
      : musicStyles;
    const options = pool.length > 0 ? pool : musicStyles;
    return options[Math.floor(Math.random() * options.length)].id;
  }

  function pickRandomStyleId(category: string | null): string | null {
    if (styles.length === 0) return null;
    const pool = category
      ? styles.filter((s) => (s.category || "Other") === category)
      : styles;
    const options = pool.length > 0 ? pool : styles;
    return options[Math.floor(Math.random() * options.length)].id;
  }

  async function handleSubmit() {
    if (!audioBlob) {
      setError("Record or upload a prayer first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setQuotaExceeded(false);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      // 1. Create the prayer row. The style picker only shows categories
      //    (see selectStyleCategory) — the specific clip within that
      //    category is randomized here, at the last possible moment, rather
      //    than when the category was clicked. A library photo (unlike an
      //    uploaded one) is already a public URL, so it can go straight into
      //    the initial insert — no separate upload step needed for it.
      // A cartoon character takes priority over any photo/video style — the
      // picker below clears the other two when one is chosen, but prefer
      // the more specific explicit choice defensively here too.
      const usingCartoon = Boolean(cartoonCharacterId);
      const usingPhoto = !usingCartoon && Boolean(photoFile || libraryPhotoUrl);
      const styleId =
        usingCartoon || usingPhoto ? null : pickRandomStyleId(selectedStyleCategory);
      const { data: prayer, error: prayerError } = await supabase
        .from("prayers")
        .insert({
          user_id: user.id,
          recipient_name: recipientName || null,
          include_recipient_in_title: Boolean(recipientName.trim()) && includeRecipientInTitle,
          occasion: occasion || null,
          style_id: styleId,
          photo_asset_url: usingCartoon ? null : photoFile ? null : libraryPhotoUrl,
          music_style_id: pickRandomMusicStyleId(musicCategory),
          text_style: textStyle,
          accent_color: accentColor,
          cartoon_character_id: cartoonCharacterId,
          privacy: "private",
        })
        .select()
        .single();

      if (prayerError || !prayer) throw prayerError;

      // 2. If the user chose "Upload your own photo" instead of a library
      //    style, upload it to Storage and record its URL on the prayer row
      //    — the render worker (worker/index.js) checks photo_asset_url
      //    first and, when set, generates a Ken Burns pan/zoom background
      //    from it instead of downloading a library style's video.
      if (photoFile) {
        const photoExt = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const photoPath = `${user.id}/${prayer.id}/photo.${photoExt}`;
        const { error: photoUploadError } = await supabase.storage
          .from("prayer-photos")
          .upload(photoPath, photoFile, {
            contentType: photoFile.type || "image/jpeg",
          });

        if (photoUploadError) throw photoUploadError;

        const { data: photoPublicUrl } = supabase.storage
          .from("prayer-photos")
          .getPublicUrl(photoPath);

        const { error: photoUpdateError } = await supabase
          .from("prayers")
          .update({ photo_asset_url: photoPublicUrl.publicUrl })
          .eq("id", prayer.id);

        if (photoUpdateError) throw photoUpdateError;
      }

      // 3. Upload the raw audio to Storage. The extension has to match the
      //    actual container (see extensionForMimeType above) — Whisper
      //    transcription downstream infers the audio format from this
      //    filename, so a mismatched extension (e.g. always ".webm" for an
      //    iPhone's MP4 recording) breaks transcription silently.
      const ext = extensionForMimeType(audioBlob.type);
      const path = `${user.id}/${prayer.id}/raw.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("prayer-audio")
        .upload(path, audioBlob, { contentType: audioBlob.type });

      if (uploadError) throw uploadError;

      const { data: publicUrl } = supabase.storage
        .from("prayer-audio")
        .getPublicUrl(path);

      // 4. Record the media asset.
      const { error: assetError } = await supabase.from("media_assets").insert({
        prayer_id: prayer.id,
        type: "raw_audio",
        storage_url: publicUrl.publicUrl,
      });

      if (assetError) throw assetError;

      // 5. Kick off transcription + theme detection (Sprint 2). The render
      //    job itself is created server-side by this route, ONLY after
      //    transcript/captions/word_timings/title are all written — NOT
      //    here. Creating it here (as this used to) raced the render
      //    worker's ~5s poll loop against transcription, which routinely
      //    takes longer than that: the worker would grab the job and
      //    render before processing finished, producing a video with the
      //    fallback title and no captions at all. Best-effort — if this
      //    fails (e.g. missing API keys), the prayer still exists and can
      //    be retried from its detail page, which also queues the render.
      setProcessing(true);
      try {
        await fetch(`/api/prayers/${prayer.id}/process`, { method: "POST" });
      } catch {
        // non-fatal — retry button lives on the prayer page
      }

      router.push(`/prayers/${prayer.id}`);
    } catch (err) {
      // enforce_prayer_quota() raises this exact message once billing is
      // enabled and a free-tier user is past their 2 videos this month —
      // give them a real next step instead of a generic error.
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err && "message" in err
            ? String((err as { message: unknown }).message)
            : "Something went wrong.";

      if (message === "quota_exceeded") {
        setQuotaExceeded(true);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <HeroBanner variant="slim" />
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-6 py-16">
        <h1 className="text-2xl font-semibold">Create a Prayer</h1>

      <section className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Recipient (optional)
          {/* text-base is required here, not cosmetic: Tailwind's preflight
              makes inputs inherit font-size from their parent (this label,
              at text-sm/14px), and any input under 16px makes iOS Safari
              forcibly zoom the whole page in when it's focused. */}
          <input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="e.g. Marcus"
            className="rounded-lg border border-sage-300 px-4 py-2 text-base"
          />
        </label>

        {recipientName.trim() && (
          <label className="flex items-start gap-2 text-sm text-sage-600">
            <input
              type="checkbox"
              checked={includeRecipientInTitle}
              onChange={(e) => setIncludeRecipientInTitle(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              Show &ldquo;{recipientName.trim()}&rdquo; in the video&apos;s title.
              {" "}If checked, their name will be burned into the video and
              its thumbnail — leave unchecked to keep the title generic so
              you can share this prayer with anyone.
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Occasion (optional)
          <input
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder="e.g. New job"
            className="rounded-lg border border-sage-300 px-4 py-2 text-base"
          />
        </label>
      </section>

      <section className="flex flex-col items-center gap-4 rounded-xl border border-sage-200 p-6">
        {recordingState !== "recorded" && (
          <button
            onClick={
              recordingState === "recording" ? stopRecording : startRecording
            }
            className={`rounded-full px-6 py-3 text-white transition ${
              recordingState === "recording"
                ? "bg-red-600 hover:bg-red-500"
                : "bg-sage-600 hover:bg-sage-700"
            }`}
          >
            {recordingState === "recording" ? "Stop Recording" : "Start Recording"}
          </button>
        )}

        {audioUrl && (
          <div className="flex w-full flex-col items-center gap-2">
            <audio src={audioUrl} controls className="w-full" />
            <button
              onClick={() => {
                setAudioBlob(null);
                setAudioUrl(null);
                setRecordingState("idle");
              }}
              className="text-sm text-sage-500 underline"
            >
              Re-record
            </button>
          </div>
        )}

        <div className="text-sm text-sage-400">or</div>

        <label className="cursor-pointer text-sm text-sage-600 underline">
          Upload an audio file
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </section>

      {cartoonCharacters.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">🎭 Funny Cartoon (optional)</p>
          <p className="text-xs text-sage-400">
            Pick a character to have your prayer read aloud in a silly voice
            by that character instead of your own recorded voice — no text
            is shown on screen, just the character.
          </p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => selectCartoonCharacter(null)}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-3 text-center text-xs transition ${
                !cartoonCharacterId
                  ? "border-sage-600 bg-sage-600 text-white"
                  : "border-dashed border-sage-400 text-sage-600 hover:bg-sage-50"
              }`}
            >
              None
            </button>
            {cartoonCharacters.map((character) => (
              <button
                key={character.id}
                type="button"
                onClick={() => selectCartoonCharacter(character.id)}
                className={`flex flex-col items-center gap-1 overflow-hidden rounded-lg border-2 p-1 text-center text-xs transition ${
                  cartoonCharacterId === character.id
                    ? "border-sage-600"
                    : "border-transparent hover:border-sage-300"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail grid, same as the photo library picker above */}
                <img
                  src={character.image_asset}
                  alt={character.name}
                  className="aspect-square w-full rounded object-cover"
                />
                <span className="text-sage-600">{character.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!cartoonCharacterId && styles.length > 0 && (() => {
        // One tile per category (e.g. "Celebration"), not one per clip —
        // the library has many clips per category (see /credits), which
        // made this grid long and repetitive. The specific clip is chosen
        // randomly at submit time (pickRandomStyleId), so picking a
        // category is still enough to get real variety across prayers.
        const categories = Array.from(
          new Set(styles.map((s) => s.category || "Other"))
        );
        return (
          <section className="flex flex-col gap-3">
            <p className="text-sm font-medium">Choose a video style</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-2 py-3 text-center text-sm transition ${
                  photoFile
                    ? "border-sage-600 bg-sage-600 text-white"
                    : "border-dashed border-sage-400 text-sage-600 hover:bg-sage-50"
                }`}
              >
                {photoPreviewUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview, not a remote/optimizable image */}
                    <img
                      src={photoPreviewUrl}
                      alt=""
                      className="h-16 w-16 rounded object-cover"
                    />
                    <span className="text-xs">Your photo (tap to change)</span>
                  </>
                ) : (
                  <span>📷 Upload your own photo</span>
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
                  className={`flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border px-2 py-3 text-center text-sm transition ${
                    libraryPhotoUrl
                      ? "border-sage-600 bg-sage-600 text-white"
                      : "border-dashed border-sage-400 text-sage-600 hover:bg-sage-50"
                  }`}
                >
                  {libraryPhotoUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail, not worth Next/Image's overhead for a small picker tile */}
                      <img
                        src={libraryPhotoUrl}
                        alt=""
                        className="h-16 w-16 rounded object-cover"
                      />
                      <span className="text-xs">Library photo (tap to change)</span>
                    </>
                  ) : (
                    <span>🖼️ Browse photo library</span>
                  )}
                </button>
              )}
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => selectStyleCategory(cat)}
                  className={`rounded-lg border px-4 py-3 text-sm transition ${
                    !photoFile && !libraryPhotoUrl && selectedStyleCategory === cat
                      ? "border-sage-600 bg-sage-600 text-white"
                      : "border-sage-300 hover:bg-sage-50"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {(photoFile || libraryPhotoUrl) && (
              <p className="text-xs text-sage-400">
                {photoFile ? "Your photo" : "The selected photo"} will move
                with a gentle pan &amp; zoom (Ken Burns) effect instead of
                using a library video.
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
                        {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail grid, Next/Image's remote-pattern config isn't worth it for a seeded stock library */}
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
          </section>
        );
      })()}

      {musicStyles.length > 0 && (() => {
        const categories = Array.from(
          new Set(musicStyles.map((m) => m.category || "Other"))
        );
        return (
      <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">Choose a music style</p>
          {/* Category tiles only — no individual track list. This mirrors the
              video style picker above: with 60+ tracks in the library, listing
              every one made the page enormous and the relationship between the
              category chips and the track grid below them read as two separate
              controls rather than a filter. The specific track is drawn at
              random from the chosen category at submit time
              (pickRandomMusicStyleId), which also means two prayers made with
              the same category don't come out with identical music. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setMusicCategory(cat)}
                className={`rounded-lg border px-4 py-3 text-sm transition ${
                  musicCategory === cat
                    ? "border-sage-600 bg-sage-600 text-white"
                    : "border-sage-300 hover:bg-sage-50"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
      </section>
        );
      })()}

      {!cartoonCharacterId && (
      <section className="flex flex-col gap-3">
        <p className="text-sm font-medium">Text style</p>
        <div className="grid grid-cols-3 gap-3">
          {TEXT_STYLE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTextStyle(option.id)}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-3 py-4 transition ${
                textStyle === option.id
                  ? "border-sage-600 bg-sage-600"
                  : "border-sage-300 hover:bg-sage-50"
              }`}
            >
              <span
                className={`text-2xl leading-tight ${
                  textStyle === option.id ? "text-white" : "text-sage-900"
                }`}
                style={{ fontFamily: option.fontVar }}
              >
                {option.sample}
              </span>
              <span
                className={`text-xs ${
                  textStyle === option.id ? "text-sage-300" : "text-sage-500"
                }`}
              >
                {option.label}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-2 text-sm font-medium">Accent color</p>
        <div className="flex gap-3">
          {ACCENT_COLOR_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAccentColor(option.id)}
              title={option.label}
              aria-label={option.label}
              className={`h-9 w-9 rounded-full border-2 transition ${
                accentColor === option.id
                  ? "border-sage-900 ring-2 ring-offset-2 ring-sage-900"
                  : "border-sage-300"
              }`}
              style={{ backgroundColor: option.hex }}
            />
          ))}
        </div>
        <p className="text-xs text-sage-400">
          Applied to the title in your video and its thumbnail.
        </p>
      </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {quotaExceeded && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-sage-300 bg-sage-50 p-4 text-center text-sm text-sage-700">
          <p>
            You&apos;ve used your 2 free prayer videos this month. Upgrade to
            PrayerMessenger Plus for unlimited videos, or buy just one more.
          </p>
          <Link
            href="/pricing"
            className="rounded-full bg-sage-600 px-4 py-2 text-white transition hover:bg-sage-700"
          >
            See plans
          </Link>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || !audioBlob}
        className="rounded-full bg-sage-600 px-6 py-3 text-white transition hover:bg-sage-700 disabled:opacity-50"
      >
        {processing
          ? "Transcribing & analyzing…"
          : submitting
            ? "Submitting…"
            : "Create Prayer Video"}
      </button>
      </main>
    </>
  );
}

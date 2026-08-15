"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import HeroBanner from "../hero-banner";
import type { AccentColor, MusicStyle, Style, TextStyle } from "@/lib/types";

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
  const [occasion, setOccasion] = useState("");
  const [styles, setStyles] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [musicStyles, setMusicStyles] = useState<MusicStyle[]>([]);
  const [selectedMusicStyleId, setSelectedMusicStyleId] = useState<string | null>(
    null
  );
  const [textStyle, setTextStyle] = useState<TextStyle>("calligraphy");
  const [accentColor, setAccentColor] = useState<AccentColor>("gold");

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    supabase
      .from("styles")
      .select("id, name, visual_asset, music_asset, caption_template")
      .then(({ data }) => {
        if (data) {
          setStyles(data as Style[]);
          if (data.length > 0) setSelectedStyleId(data[0].id);
        }
      });
    // Music is chosen independently of the visual style — see
    // supabase/migrations/0010_music_styles.sql.
    supabase
      .from("music_styles")
      .select("id, name, music_asset")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data) {
          setMusicStyles(data as MusicStyle[]);
          if (data.length > 0) setSelectedMusicStyleId(data[0].id);
        }
      });
  }, [supabase]);

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

      // 1. Create the prayer row.
      const { data: prayer, error: prayerError } = await supabase
        .from("prayers")
        .insert({
          user_id: user.id,
          recipient_name: recipientName || null,
          occasion: occasion || null,
          style_id: selectedStyleId,
          music_style_id: selectedMusicStyleId,
          text_style: textStyle,
          accent_color: accentColor,
          privacy: "private",
        })
        .select()
        .single();

      if (prayerError || !prayer) throw prayerError;

      // 2. Upload the raw audio to Storage. The extension has to match the
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

      // 3. Record the media asset.
      const { error: assetError } = await supabase.from("media_assets").insert({
        prayer_id: prayer.id,
        type: "raw_audio",
        storage_url: publicUrl.publicUrl,
      });

      if (assetError) throw assetError;

      // 4. Kick off transcription + theme detection (Sprint 2). The render
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

      {styles.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">Choose a style</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {styles.map((style) => (
              <button
                key={style.id}
                onClick={() => setSelectedStyleId(style.id)}
                className={`rounded-lg border px-4 py-3 text-sm transition ${
                  selectedStyleId === style.id
                    ? "border-sage-600 bg-sage-600 text-white"
                    : "border-sage-300 hover:bg-sage-50"
                }`}
              >
                {style.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {musicStyles.length > 0 && (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">Choose a music style</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {musicStyles.map((musicStyle) => (
              <button
                key={musicStyle.id}
                type="button"
                onClick={() => setSelectedMusicStyleId(musicStyle.id)}
                className={`rounded-lg border px-4 py-3 text-sm transition ${
                  selectedMusicStyleId === musicStyle.id
                    ? "border-sage-600 bg-sage-600 text-white"
                    : "border-sage-300 hover:bg-sage-50"
                }`}
              >
                {musicStyle.name}
              </button>
            ))}
          </div>
        </section>
      )}

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

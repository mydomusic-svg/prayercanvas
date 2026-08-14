"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AccentColor, Style, TextStyle } from "@/lib/types";

type RecordingState = "idle" | "recording" | "recorded";

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
  const [textStyle, setTextStyle] = useState<TextStyle>("calligraphy");
  const [accentColor, setAccentColor] = useState<AccentColor>("gold");

  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [supabase]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
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
          text_style: textStyle,
          accent_color: accentColor,
          privacy: "private",
        })
        .select()
        .single();

      if (prayerError || !prayer) throw prayerError;

      // 2. Upload the raw audio to Storage.
      const path = `${user.id}/${prayer.id}/raw.webm`;
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
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold">Create a Prayer</h1>

      <section className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Recipient (optional)
          <input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="e.g. Marcus"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Occasion (optional)
          <input
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
            placeholder="e.g. New job"
            className="rounded-lg border border-neutral-300 px-4 py-2"
          />
        </label>
      </section>

      <section className="flex flex-col items-center gap-4 rounded-xl border border-neutral-200 p-6">
        {recordingState !== "recorded" && (
          <button
            onClick={
              recordingState === "recording" ? stopRecording : startRecording
            }
            className={`rounded-full px-6 py-3 text-white transition ${
              recordingState === "recording"
                ? "bg-red-600 hover:bg-red-500"
                : "bg-neutral-900 hover:bg-neutral-700"
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
              className="text-sm text-neutral-500 underline"
            >
              Re-record
            </button>
          </div>
        )}

        <div className="text-sm text-neutral-400">or</div>

        <label className="cursor-pointer text-sm text-neutral-600 underline">
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
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {style.name}
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
                  ? "border-neutral-900 bg-neutral-900"
                  : "border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              <span
                className={`text-2xl leading-tight ${
                  textStyle === option.id ? "text-white" : "text-neutral-900"
                }`}
                style={{ fontFamily: option.fontVar }}
              >
                {option.sample}
              </span>
              <span
                className={`text-xs ${
                  textStyle === option.id ? "text-neutral-300" : "text-neutral-500"
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
                  ? "border-neutral-900 ring-2 ring-offset-2 ring-neutral-900"
                  : "border-neutral-300"
              }`}
              style={{ backgroundColor: option.hex }}
            />
          ))}
        </div>
        <p className="text-xs text-neutral-400">
          Applied to the title in your video and its thumbnail.
        </p>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting || !audioBlob}
        className="rounded-full bg-neutral-900 px-6 py-3 text-white transition hover:bg-neutral-700 disabled:opacity-50"
      >
        {processing
          ? "Transcribing & analyzing…"
          : submitting
            ? "Submitting…"
            : "Create Prayer Video"}
      </button>
    </main>
  );
}

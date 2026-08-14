import OpenAI from "openai";
import { toFile } from "openai/uploads";

export interface CaptionSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  /** Segment-level timestamps from Whisper — used as caption chunks in the
   * rendered video (Sprint 3), so we don't have to guess timing ourselves. */
  segments: CaptionSegment[];
}

/**
 * Transcribes a prayer recording using OpenAI's Whisper API.
 * Requires OPENAI_API_KEY in the environment.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename = "prayer.webm"
): Promise<TranscriptionResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local to enable transcription."
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const file = await toFile(audioBuffer, filename);

  const result = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
  });

  // The SDK's base type only guarantees `text`; verbose_json also returns
  // per-segment timestamps that aren't in the narrow response type.
  const raw = result as unknown as {
    text: string;
    segments?: { text: string; start: number; end: number }[];
  };

  return {
    text: raw.text,
    segments: (raw.segments ?? []).map((s) => ({
      text: s.text.trim(),
      start: s.start,
      end: s.end,
    })),
  };
}

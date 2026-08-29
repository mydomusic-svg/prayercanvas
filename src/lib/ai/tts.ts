import OpenAI from "openai";

// OpenAI's text-to-speech voices as of the tts-1 model — this is the full
// set; a cartoon_characters row picks one of these as its base voice, and
// the render worker layers a pitch/speed effect on top of it (see
// worker/index.js's buildFilterComplex cartoonMode branch) to make it
// actually sound "cartoonish" rather than just a plain narrator voice.
export type OpenAiVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer";

/**
 * Synthesizes speech for the Funny Cartoon category: reads `text` aloud in
 * one of OpenAI's stock TTS voices. Used in place of the user's own
 * recording when a prayer has a cartoon_character_id set (see the process
 * route) — the resulting audio is uploaded as a 'cartoon_audio' media asset
 * and picked up by the render worker instead of raw_audio.
 *
 * Requires OPENAI_API_KEY in the environment (same var transcribeAudio
 * uses).
 */
export async function synthesizeSpeech(
  text: string,
  voice: OpenAiVoice
): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local to enable cartoon voice synthesis."
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // tts-1 (not tts-1-hd): a prayer reading doesn't need the HD model's extra
  // fidelity, and the worker re-encodes this to AAC in the final render
  // anyway — no reason to pay for/wait on the higher-quality model.
  const response = await client.audio.speech.create({
    model: "tts-1",
    voice,
    input: text,
    response_format: "mp3",
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

import OpenAI from "openai";

// The narrator's voices: tts-1's full set. A prayer read straight is read
// by one of these, at NARRATION_SPEED, with no delivery direction — see
// synthesizeSpeech below.
export type OpenAiVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer";

// The cartoon characters' voices: gpt-4o-mini-tts's set, which is a strict
// superset of tts-1's. The extra five matter — `coral`, `ballad`, `verse`,
// `sage` and `ash` are where the bright, light end of the range lives, and
// without them five characters have to share tts-1's two non-grave voices
// and stop sounding like five characters.
//
// Worth stating plainly, because it shapes everything below: NO OpenAI
// model ships a child voice. Every one of these is an adult. A voice that
// reads as a kids' cartoon is built, not picked — bright voice, plus the
// delivery direction in synthesizeCharacterSpeech, plus the per-character
// EQ the worker layers on afterwards.
export type CartoonVoice =
  | OpenAiVoice
  | "ash"
  | "ballad"
  | "coral"
  | "sage"
  | "verse";

/**
 * How fast the narrator reads, as a multiplier on tts-1's default.
 *
 * The default (1.0) reads at roughly 200+ words per minute — a brisk
 * newsreader pace. That is wrong for this app: a prayer is meant to be
 * dwelt on, and a 23-word prayer arriving in six seconds feels rushed past
 * rather than spoken. 0.85 brings it to roughly 170wpm, close to how
 * someone actually prays aloud, and gives the words room to land.
 *
 * Cartoon characters used to override this and read at 1.0, on the theory
 * that a slowed-down duck sounds sedated rather than funny. That was
 * written for jokey one-line prayers, and it is wrong now that a character
 * can be handed a Bible verse: "O give thanks unto the LORD; for he is
 * good: for his mercy endureth for ever" arrived in FOUR SECONDS — about
 * 3.4 words a second, half again faster than anyone reads scripture aloud.
 * It sounded gabbled, not lively.
 *
 * What makes these voices funny is the pitch shift and the vibrato the
 * worker layers on (VOICE_EFFECTS), not the rate. So they read at the same
 * unhurried pace as the narrator now, and stay just as silly.
 */
export const NARRATION_SPEED = 0.85;

/**
 * Kept only so an existing caller or script importing it still compiles.
 * Nothing uses it: cartoon characters moved to gpt-4o-mini-tts (0028),
 * which takes no speed multiplier, and their pace is directed in words
 * inside voice_instructions instead. Delete this once nothing references
 * it.
 *
 * @deprecated pace for characters lives in voice_instructions now.
 */
export const CARTOON_SPEED = 0.85;

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
  voice: OpenAiVoice,
  speed: number = NARRATION_SPEED
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
    // OpenAI accepts 0.25-4.0 and clamps outside that; guard here anyway so
    // a bad caller can never produce a garbled read.
    speed: Math.min(Math.max(speed, 0.5), 1.5),
    response_format: "mp3",
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Used when a cartoon_characters row has no voice_instructions of its own.
 * Carries the two guards every per-character instruction in 0028 ends
 * with: an explicit pace, because an unsteered model reads a Bible verse
 * at newsreader speed, and a sincerity floor, because these are prayers —
 * sometimes for someone who is ill — and a playful voice that tips into
 * sarcasm would be worse than a flat one.
 */
export const DEFAULT_CARTOON_INSTRUCTIONS =
  "You are a friendly cartoon character reading aloud to a small child. " +
  "Warm, bright and light-hearted. Keep the pace unhurried and every word " +
  "clear, about the speed of reading a picture book aloud to a five-year-old, " +
  "never rushed. The words are a prayer, so stay sincere and kind underneath " +
  "the fun. Never sound sarcastic, spooky or sad.";

/**
 * Synthesizes a cartoon character's voice.
 *
 * Separate from synthesizeSpeech, and on a different model, for one
 * reason: gpt-4o-mini-tts accepts an `instructions` string describing how
 * to deliver the line — tone, energy, character, pace — and tts-1 accepts
 * nothing but a voice name. That parameter is the whole point. Since no
 * OpenAI model has a child voice, "light-hearted, for kids" can only be
 * reached by directing an adult voice, and this is the only API surface
 * that takes direction.
 *
 * The narrator deliberately stays on tts-1. It is cheaper per call by a
 * hair, it is the path every non-cartoon prayer takes, and more to the
 * point a prayer read straight should not be steered playful — there is
 * nothing for an instructions string to usefully say.
 *
 * NO `speed` PARAMETER HERE, and that is deliberate rather than an
 * oversight. tts-1 exposes `speed` as a numeric multiplier and the
 * narrator uses it (NARRATION_SPEED). gpt-4o-mini-tts is not documented as
 * honouring it, and quietly ignoring a speed argument is exactly the
 * failure mode that produced gabbled scripture last time — the pace looked
 * set in the code and was not set in the audio. So pace is directed in
 * words, inside the instruction string itself ("unhurried… about the speed
 * of reading a picture book aloud"), where it is part of the same
 * direction as everything else and can be tuned by ear in the database.
 * scripts/sample-cartoon-voices.mjs measures the result in words per
 * minute so this is checked rather than assumed.
 */
export async function synthesizeCharacterSpeech(
  text: string,
  voice: CartoonVoice,
  instructions: string | null
): Promise<Buffer> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local to enable cartoon voice synthesis."
    );
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice,
    input: text,
    // A character row seeded before 0028 has no instructions yet. Falling
    // back to the shared direction keeps it kid-appropriate rather than
    // letting it read in the model's default register, which is an adult
    // assistant voice.
    instructions: instructions ?? DEFAULT_CARTOON_INSTRUCTIONS,
    response_format: "mp3",
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

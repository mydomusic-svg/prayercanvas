import Anthropic from "@anthropic-ai/sdk";

export const PRAYER_THEMES = [
  "encouragement",
  "healing",
  "gratitude",
  "grief",
  "protection",
  "celebration",
  "new beginnings",
] as const;

export type PrayerTheme = (typeof PRAYER_THEMES)[number];

export interface PrayerAnalysis {
  theme: PrayerTheme;
  title: string;
  // Suggested library categories for this prayer's backing music and
  // background visuals. Null when the model didn't offer one, or offered one
  // that isn't in the live library — the caller falls back to keyword
  // matching (see keyword-match.ts) rather than forcing a bad guess.
  musicCategory: string | null;
  visualCategory: string | null;
}

/**
 * Uses Claude to detect the theme and suggest a short title for a
 * transcribed prayer. Requires ANTHROPIC_API_KEY in the environment.
 */
export async function analyzePrayer(input: {
  transcript: string;
  recipientName?: string | null;
  // Whether the recipient's name is allowed to appear in the generated
  // title (see the checkbox in create/page.tsx and the
  // include_recipient_in_title column). Default false: most prayers get
  // shared with whoever the user likes, and the title is burned directly
  // into the rendered video, so a name here should be opt-in, not assumed.
  // Rather than trust the model to reliably omit a name it was merely told
  // not to use, the name is simply never included in the prompt at all when
  // this is false — the model can't leak what it was never given.
  includeRecipientName?: boolean;
  occasion?: string | null;
  // The categories actually present in the library right now, passed in
  // rather than hardcoded so adding a category to the database is enough —
  // no code change needed here to make the model aware of it.
  musicCategories?: string[];
  visualCategories?: string[];
}): Promise<PrayerAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable theme detection."
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const recipientForPrompt =
    input.includeRecipientName && input.recipientName ? input.recipientName : null;
  const musicCats = input.musicCategories ?? [];
  const visualCats = input.visualCategories ?? [];

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: [
      "You analyze short spoken prayers for a prayer-video app.",
      `Respond with ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:`,
      `{"theme": one of [${PRAYER_THEMES.map((t) => `"${t}"`).join(", ")}], "title": a short warm 3-6 word title for this prayer${
        musicCats.length
          ? `, "musicCategory": one of [${musicCats.map((c) => `"${c}"`).join(", ")}]`
          : ""
      }${
        visualCats.length
          ? `, "visualCategory": one of [${visualCats.map((c) => `"${c}"`).join(", ")}]`
          : ""
      }}`,
      musicCats.length || visualCats.length
        ? "Choose the music and visuals that genuinely fit what this prayer is about — a prayer asking for protection or safety over someone should feel watchful and reverent, one celebrating a birth or a wedding should feel joyful, one about loss should feel gentle and restrained. Judge the meaning of what was said, not just individual words."
        : "",
      recipientForPrompt
        ? `The recipient's name is given below — feel free to include it in the title (e.g. "A Prayer for ${recipientForPrompt}").`
        : `Do not address or name any specific person in the title — keep it generic enough that it reads naturally for anyone who receives this video.`,
    ].join(" "),
    messages: [
      {
        role: "user",
        content: [
          `Recipient: ${recipientForPrompt || "unspecified"}`,
          `Occasion: ${input.occasion || "unspecified"}`,
          `Transcript: "${input.transcript}"`,
        ].join("\n"),
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Unexpected response from Claude — no text content.");
  }

  // Claude sometimes wraps JSON in ```json ... ``` fences despite instructions
  // not to — strip them before parsing rather than failing on well-formed
  // responses.
  const cleaned = textBlock.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: PrayerAnalysis;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude did not return valid JSON: ${textBlock.text}`);
  }

  if (!PRAYER_THEMES.includes(parsed.theme)) {
    throw new Error(`Claude returned an unrecognized theme: ${parsed.theme}`);
  }

  // A category the library doesn't have is worse than no category — null it
  // so the caller's keyword fallback gets a chance instead of writing a
  // reference to something that doesn't exist.
  const valid = (value: unknown, allowed: string[]) =>
    typeof value === "string" && allowed.includes(value) ? value : null;

  return {
    theme: parsed.theme,
    title: parsed.title,
    musicCategory: valid(parsed.musicCategory, musicCats),
    visualCategory: valid(parsed.visualCategory, visualCats),
  };
}

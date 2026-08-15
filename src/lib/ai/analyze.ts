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
}): Promise<PrayerAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable theme detection."
    );
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const recipientForPrompt =
    input.includeRecipientName && input.recipientName ? input.recipientName : null;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: [
      "You analyze short spoken prayers for a prayer-video app.",
      `Respond with ONLY valid JSON, no prose, no markdown fences, matching exactly this shape:`,
      `{"theme": one of [${PRAYER_THEMES.map((t) => `"${t}"`).join(", ")}], "title": a short warm 3-6 word title for this prayer}`,
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

  return parsed;
}

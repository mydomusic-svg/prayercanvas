import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Devotional commentary on a passage, cached forever.
 *
 * COST SHAPE. A generation is roughly 600 input + 350 output tokens on
 * Haiku 4.5 ($1/$5 per MTok) — about $0.0024. The Bible is finite, so the
 * cache turns this into a one-time cost: all 1,189 chapters would total
 * under $3, once, for every user who ever reads them. That is why there is
 * no user-facing limit; the cap below exists only so a script cannot walk
 * every possible verse RANGE (which, unlike chapters, is combinatorial).
 */

// Far above real study. Someone reading attentively might generate a dozen
// explanations in a sitting; this only stops automated walking.
const MAX_GENERATIONS_PER_DAY = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    translation?: string;
    book?: string;
    bookOrder?: number;
    chapter?: number;
    verseStart?: number;
    verseEnd?: number;
    reference?: string;
    text?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const {
    translation,
    book,
    bookOrder,
    chapter,
    verseStart,
    verseEnd,
    reference,
    text,
  } = body;

  if (
    !translation ||
    !book ||
    !bookOrder ||
    !chapter ||
    !verseStart ||
    !verseEnd ||
    !reference ||
    !text?.trim()
  ) {
    return NextResponse.json({ error: "Missing passage details" }, { status: 400 });
  }

  const admin = createAdminClient();
  const passageKey = `${translation}:${bookOrder}:${chapter}:${verseStart}-${verseEnd}`;

  // CACHE FIRST. The overwhelming majority of requests end here, cost
  // nothing, and return instantly.
  const { data: cached } = await admin
    .from("bible_commentary")
    .select("commentary, reference")
    .eq("passage_key", passageKey)
    .maybeSingle();
  if (cached) {
    return NextResponse.json({
      commentary: cached.commentary,
      reference: cached.reference,
      cached: true,
    });
  }

  // Only NEW passages count against the cap.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("commentary_generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  if ((count ?? 0) >= MAX_GENERATIONS_PER_DAY) {
    return NextResponse.json(
      {
        error:
          "You've reached today's limit for new explanations. Passages that have already been explained are still available.",
      },
      { status: 429 }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Commentary isn't configured yet." },
      { status: 503 }
    );
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // DEVOTIONAL, NOT DOCTRINAL.
    //
    // The brief is warmth and encouragement — what this passage offers
    // someone reading it today. The guardrails matter as much as the tone:
    // this is going to people in real difficulty, so it must not diagnose,
    // must not promise particular outcomes, and must not tell someone their
    // circumstances are a judgment on them. Where a passage is genuinely
    // read differently across traditions, saying so is more honest than
    // picking a winner and presenting it as settled.
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system:
        "You write short devotional reflections on Bible passages for a prayer app. " +
        "Your voice is warm, plain and encouraging — like a thoughtful friend, not a lecturer or a preacher. " +
        "Write 2 to 3 short paragraphs.\n\n" +
        "Cover, briefly: what this passage is saying, and what someone might hold onto from it today. " +
        "You may mention the setting or who it was written to when that genuinely helps it land.\n\n" +
        "Rules:\n" +
        "- Speak to the reader as 'you'. No headings, no bullet points, no verse numbers.\n" +
        "- Where major Christian traditions clearly read a passage differently, note that briefly rather than presenting one reading as the only one.\n" +
        "- Never promise a specific outcome (healing, money, reconciliation) as something God will certainly do.\n" +
        "- Never suggest someone's hardship is punishment, a lack of faith, or their fault.\n" +
        "- Never give medical, legal, or financial advice, and never discourage anyone from seeking professional help.\n" +
        "- If the passage is violent, disputed or difficult, be honest about that rather than forcing comfort onto it.",
      messages: [
        {
          role: "user",
          content: `${reference}\n\n${text.trim()}`,
        },
      ],
    });

    const commentary = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!commentary) throw new Error("Empty commentary");

    // Cache for everyone. Ignore a conflict — two people asking for the same
    // passage at once is a race worth losing quietly.
    await admin.from("bible_commentary").upsert(
      {
        passage_key: passageKey,
        translation,
        book,
        chapter,
        verse_start: verseStart,
        verse_end: verseEnd,
        reference,
        commentary,
      },
      { onConflict: "passage_key" }
    );
    await admin.from("commentary_generations").insert({ user_id: user.id });

    return NextResponse.json({ commentary, reference, cached: false });
  } catch (err) {
    console.error("Commentary generation failed:", err);
    return NextResponse.json(
      { error: "Couldn't write an explanation just now. Try again in a moment." },
      { status: 500 }
    );
  }
}

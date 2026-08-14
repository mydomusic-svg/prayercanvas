import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { analyzePrayer } from "@/lib/ai/analyze";

/**
 * Transcribes a prayer's audio and detects its theme/title.
 * Sprint 2 of the MVP scope. Video rendering (Sprint 3) is separate and
 * still handled by the not-yet-built render worker.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // RLS ensures this only returns a row if the caller owns it.
  const { data: prayer, error: prayerError } = await supabase
    .from("prayers")
    .select("id, recipient_name, occasion")
    .eq("id", id)
    .single();

  if (prayerError || !prayer) {
    return NextResponse.json({ error: "Prayer not found" }, { status: 404 });
  }

  const { data: audioAsset, error: assetError } = await supabase
    .from("media_assets")
    .select("storage_url")
    .eq("prayer_id", id)
    .eq("type", "raw_audio")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assetError || !audioAsset) {
    return NextResponse.json(
      { error: "No audio found for this prayer" },
      { status: 400 }
    );
  }

  try {
    const audioResponse = await fetch(audioAsset.storage_url);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio (${audioResponse.status})`);
    }
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

    const { text: transcript, segments, words } = await transcribeAudio(audioBuffer);

    if (!transcript.trim()) {
      throw new Error(
        "Transcription came back empty — try re-recording with clearer audio."
      );
    }

    const { theme, title } = await analyzePrayer({
      transcript,
      recipientName: prayer.recipient_name,
      occasion: prayer.occasion,
    });

    const { error: updateError } = await supabase
      .from("prayers")
      .update({ transcript, theme, title, captions: segments, word_timings: words })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ transcript, theme, title, captions: segments, words });
  } catch (err) {
    console.error("Prayer processing failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}

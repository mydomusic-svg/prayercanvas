import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { analyzePrayer } from "@/lib/ai/analyze";
import { synthesizeSpeech, type OpenAiVoice } from "@/lib/ai/tts";

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
    .select(
      "id, recipient_name, include_recipient_in_title, occasion, cartoon_character_id"
    )
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

    // The uploaded filename's extension reflects the actual recorded
    // container (see create/page.tsx's extensionForMimeType — this used to
    // be hardcoded to "raw.webm" for every upload, which broke Whisper on
    // iPhone recordings that are actually MP4/AAC). Whisper infers the
    // audio format from the filename it's given, so pass the real one
    // through instead of always defaulting to "prayer.webm".
    const storagePath = new URL(audioAsset.storage_url).pathname;
    const ext = storagePath.split(".").pop()?.toLowerCase() || "webm";
    const { text: transcript, segments, words } = await transcribeAudio(
      audioBuffer,
      `prayer.${ext}`
    );

    if (!transcript.trim()) {
      throw new Error(
        "Transcription came back empty — try re-recording with clearer audio."
      );
    }

    // Diagnostic: word-level timestamps have been coming back empty for very
    // short recordings — logging counts here so we can confirm whether audio
    // length is the cause without re-deploying each time we want to check.
    console.log(
      `Whisper: ${segments.length} segment(s), ${words.length} word(s) for a ${audioBuffer.byteLength}-byte clip.`
    );

    // The recipient's name is only allowed to appear in the AI-generated
    // title when the user explicitly opted in at creation time (see the
    // checkbox in create/page.tsx) — otherwise it's passed to analyzePrayer
    // purely as unnamed context, same as before, so the title stays generic
    // enough to reshare with anyone.
    const { theme, title } = await analyzePrayer({
      transcript,
      recipientName: prayer.recipient_name,
      includeRecipientName: prayer.include_recipient_in_title,
      occasion: prayer.occasion,
    });

    const { error: updateError } = await supabase
      .from("prayers")
      .update({ transcript, theme, title, captions: segments, word_timings: words })
      .eq("id", id);

    if (updateError) throw updateError;

    // Funny Cartoon category (0015_cartoon_characters.sql): the user's own
    // recording above is still transcribed as normal to get the prayer
    // text, but the video itself should be read aloud by the chosen
    // character's AI voice instead of the user's real voice. Synthesize
    // that now and store it as a separate 'cartoon_audio' media asset
    // alongside the original raw_audio — the render worker prefers
    // cartoon_audio over raw_audio whenever cartoon_character_id is set
    // (see worker/index.js). Best-effort: if this fails (e.g. missing
    // OPENAI_API_KEY, or someone picked a character before this table was
    // seeded), the render worker's own error path handles a missing
    // cartoon_audio asset rather than failing prayer creation here.
    if (prayer.cartoon_character_id) {
      try {
        const { data: character, error: characterError } = await supabase
          .from("cartoon_characters")
          .select("openai_voice")
          .eq("id", prayer.cartoon_character_id)
          .single();
        if (characterError || !character) {
          throw characterError ?? new Error("Cartoon character not found");
        }

        const cartoonAudioBuffer = await synthesizeSpeech(
          transcript,
          character.openai_voice as OpenAiVoice
        );

        const cartoonAudioPath = `${user.id}/${id}/cartoon.mp3`;
        const { error: cartoonUploadError } = await supabase.storage
          .from("prayer-audio")
          .upload(cartoonAudioPath, cartoonAudioBuffer, {
            contentType: "audio/mpeg",
            upsert: true,
          });
        if (cartoonUploadError) throw cartoonUploadError;

        const { data: cartoonPublicUrl } = supabase.storage
          .from("prayer-audio")
          .getPublicUrl(cartoonAudioPath);

        const { error: cartoonAssetError } = await supabase
          .from("media_assets")
          .insert({
            prayer_id: id,
            type: "cartoon_audio",
            storage_url: cartoonPublicUrl.publicUrl,
          });
        if (cartoonAssetError) throw cartoonAssetError;
      } catch (cartoonErr) {
        console.error(
          "Cartoon voice synthesis failed (continuing without it):",
          cartoonErr
        );
      }
    }

    // Only queue the render job now that transcript/captions/word_timings/
    // title are all written. This used to be inserted by the create page
    // right after upload, before processing even started — the render
    // worker's ~5s poll loop routinely won that race against transcription
    // (which for real audio almost always takes longer than 5s), so the
    // worker would render against an empty prayer row: fallback title only,
    // no captions, no word-highlighting. Creating the job here instead
    // guarantees the worker only ever sees a fully-processed prayer.
    const { error: jobError } = await supabase.from("render_jobs").insert({
      prayer_id: id,
      status: "pending",
    });
    if (jobError) {
      console.error("Failed to queue render job after processing:", jobError.message);
    }

    return NextResponse.json({ transcript, theme, title, captions: segments, words });
  } catch (err) {
    console.error("Prayer processing failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}

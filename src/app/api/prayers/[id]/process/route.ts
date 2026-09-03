import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { analyzePrayer } from "@/lib/ai/analyze";
import {
  synthesizeSpeech,
  CARTOON_SPEED,
  type OpenAiVoice,
} from "@/lib/ai/tts";
import { matchCategoriesByKeyword } from "@/lib/ai/keyword-match";
import { createAdminClient } from "@/lib/supabase/admin";

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
      "id, recipient_name, include_recipient_in_title, occasion, cartoon_character_id, style_id, music_style_id, photo_asset_url, input_text, narrator_voice, narration_mode"
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

  // A typed or pasted prayer (0020_typed_prayers.sql) has no recording at
  // all, so missing audio is only an error when there is also no text to
  // fall back on.
  const typedText = (prayer.input_text ?? "").trim();
  const narrationMode = prayer.narration_mode ?? "narrator";
  if ((assetError || !audioAsset) && !typedText) {
    return NextResponse.json(
      { error: "No audio or text found for this prayer" },
      { status: 400 }
    );
  }

  try {
    // TYPED PRAYERS SKIP TRANSCRIPTION ENTIRELY.
    //
    // When the user wrote the prayer themselves, that text IS the
    // transcript — and a more faithful one than Whisper could produce from
    // any recording of it. Running it through speech-to-text would only
    // introduce errors. Timings come later, from whichever synthesized
    // narration actually gets rendered.
    let transcript: string;
    let segments: Awaited<ReturnType<typeof transcribeAudio>>["segments"] = [];
    let words: Awaited<ReturnType<typeof transcribeAudio>>["words"] = [];

    if (!audioAsset) {
      transcript = typedText;
    } else {

    // The uploaded filename's extension reflects the actual recorded
    // container (see create/page.tsx's extensionForMimeType — this used to
    // be hardcoded to "raw.webm" for every upload, which broke Whisper on
    // iPhone recordings that are actually MP4/AAC). Whisper infers the
    // audio format from the filename it's given, so pass the real one
    // through instead of always defaulting to "prayer.webm".
      const audioResponse = await fetch(audioAsset.storage_url);
      if (!audioResponse.ok) {
        throw new Error(`Failed to download audio (${audioResponse.status})`);
      }
      const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

      const storagePath = new URL(audioAsset.storage_url).pathname;
      const ext = storagePath.split(".").pop()?.toLowerCase() || "webm";
      const result = await transcribeAudio(audioBuffer, `prayer.${ext}`);
      segments = result.segments;
      words = result.words;
      // READING YOUR OWN WRITTEN PRAYER ALOUD.
      //
      // When there is both a recording and written text, the WRITTEN text
      // is the transcript and the recording only supplies caption timing.
      // This matters most for scripture: what appears on screen should be
      // the verse as translated, not Whisper's impression of someone
      // reading it, which drops "thou"s and mishears proper nouns. The
      // spoken audio is still what plays.
      transcript = typedText || result.text;

      if (!transcript.trim()) {
        throw new Error(
          "Transcription came back empty — try re-recording with clearer audio."
        );
      }

      // Diagnostic: word-level timestamps have been coming back empty for
      // very short recordings — logging counts here so we can confirm
      // whether audio length is the cause without re-deploying each time.
      console.log(
        `Whisper: ${segments.length} segment(s), ${words.length} word(s) for a ${audioBuffer.byteLength}-byte clip.`
      );
    }

    // AUTO-MATCHING MUSIC AND VISUALS
    //
    // A prayer's music and background can only be matched to what it's
    // ABOUT, and what it's about is only known once it has been transcribed
    // — which is here, not at creation time. So when the user left either
    // choice on "Auto" (the create page sends null for it), the category is
    // decided now, before the render job is queued below, and the worker
    // picks it up like any other choice.
    //
    // An explicit choice is never overridden: a null id means Auto, a set
    // id means the user picked it and we leave it alone.
    const admin = createAdminClient();
    const wantsAutoMusic = !prayer.music_style_id;
    const wantsAutoVisual =
      !prayer.style_id && !prayer.photo_asset_url && !prayer.cartoon_character_id;

    const [musicRows, styleRows] = await Promise.all([
      wantsAutoMusic
        ? admin.from("music_styles").select("id, category")
        : Promise.resolve({ data: null }),
      wantsAutoVisual
        ? admin.from("styles").select("id, category, visual_asset")
        : Promise.resolve({ data: null }),
    ]);

    const musicCategories = [
      ...new Set((musicRows.data ?? []).map((r) => r.category).filter(Boolean)),
    ] as string[];
    // Only styles with a real uploaded asset are selectable — the seed data
    // leaves placeholder filenames on unseeded rows.
    const usableStyles = (styleRows.data ?? []).filter((r) =>
      r.visual_asset?.startsWith("http")
    );
    const visualCategories = [
      ...new Set(usableStyles.map((r) => r.category).filter(Boolean)),
    ] as string[];

    // The recipient's name is only allowed to appear in the AI-generated
    // title when the user explicitly opted in at creation time (see the
    // checkbox in create/page.tsx) — otherwise it's passed purely as unnamed
    // context, so the title stays generic enough to reshare with anyone.
    const { theme, title, musicCategory, visualCategory } = await analyzePrayer({
      transcript,
      recipientName: prayer.recipient_name,
      includeRecipientName: prayer.include_recipient_in_title,
      occasion: prayer.occasion,
      musicCategories,
      visualCategories,
    });

    // Claude is the primary matcher; keywords only fill in where it declined
    // or returned something not in the library (see keyword-match.ts).
    const fallback = matchCategoriesByKeyword(
      transcript,
      musicCategories,
      visualCategories
    );
    const chosenMusicCategory = musicCategory ?? fallback.musicCategory;
    const chosenVisualCategory = visualCategory ?? fallback.visualCategory;

    const pickFrom = <T extends { id: string; category: string | null }>(
      rows: T[],
      category: string | null
    ): string | null => {
      if (rows.length === 0) return null;
      const pool = category ? rows.filter((r) => r.category === category) : rows;
      // Falling back to the whole library rather than returning null keeps a
      // prayer from ending up with no music at all just because its matched
      // category happens to be empty.
      const options = pool.length > 0 ? pool : rows;
      return options[Math.floor(Math.random() * options.length)].id;
    };

    // MUSIC ROTATION.
    //
    // A pure random pick out of a category is not the same thing as variety.
    // With the handful of tracks a narrow category holds, random repeats
    // constantly — and someone who makes three prayers in a row and hears the
    // same bed each time reads that as the app being broken, not as chance.
    //
    // So the picker cycles instead. Two rules, in order:
    //
    //   1. COOLDOWN. Any track this member has had in the last 15 minutes is
    //      off the table entirely. This is the hard guarantee.
    //   2. LEAST RECENTLY USED. Of what is left, anything they have never
    //      heard comes first (random among those, so two people with the same
    //      history don't walk the library in lockstep). Only once the whole
    //      category has been used does it come back around to the track they
    //      heard longest ago.
    //
    // Together those mean a member works through a category before repeating
    // any of it, and never hears the same track twice inside a quarter hour.
    //
    // History comes from the prayers table itself rather than a new tracking
    // table — every prayer already records its user, its music and its
    // creation time, which is exactly the three things needed here.
    const MUSIC_COOLDOWN_MS = 15 * 60 * 1000;
    const { data: recentPrayers } = wantsAutoMusic
      ? await admin
          .from("prayers")
          .select("music_style_id, created_at")
          .eq("user_id", user.id)
          .not("music_style_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: null };

    // Most recent use per track. The query is already newest-first, so the
    // first time a track is seen is its latest use.
    const lastUsedAt = new Map<string, number>();
    for (const row of recentPrayers ?? []) {
      const id = row.music_style_id as string | null;
      if (!id || lastUsedAt.has(id)) continue;
      lastUsedAt.set(id, new Date(row.created_at as string).getTime());
    }

    const pickMusic = <T extends { id: string; category: string | null }>(
      rows: T[],
      category: string | null
    ): string | null => {
      if (rows.length === 0) return null;
      const pool = category ? rows.filter((r) => r.category === category) : rows;
      const options = pool.length > 0 ? pool : rows;

      const cutoff = Date.now() - MUSIC_COOLDOWN_MS;
      let eligible = options.filter((r) => (lastUsedAt.get(r.id) ?? 0) < cutoff);
      // If the cooldown would rule out everything — a category smaller than
      // the number of prayers someone just made — silence is far worse than a
      // repeat, so fall back to the full set rather than returning null.
      if (eligible.length === 0) eligible = options;

      const unheard = eligible.filter((r) => !lastUsedAt.has(r.id));
      if (unheard.length > 0) {
        return unheard[Math.floor(Math.random() * unheard.length)].id;
      }
      return eligible.reduce((oldest, r) =>
        (lastUsedAt.get(r.id) ?? 0) < (lastUsedAt.get(oldest.id) ?? 0) ? r : oldest
      ).id;
    };

    const autoMusicStyleId = wantsAutoMusic
      ? pickMusic(musicRows.data ?? [], chosenMusicCategory)
      : null;
    const autoStyleId = wantsAutoVisual
      ? pickFrom(usableStyles, chosenVisualCategory)
      : null;

    const { error: updateError } = await supabase
      .from("prayers")
      .update({
        transcript,
        theme,
        title,
        captions: segments,
        word_timings: words,
        ...(autoMusicStyleId ? { music_style_id: autoMusicStyleId } : {}),
        ...(autoStyleId ? { style_id: autoStyleId } : {}),
      })
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

        // Same unhurried pace as the narrator: the pitch effect is what
        // makes the character funny, not the speed (see tts.ts).
        const cartoonAudioBuffer = await synthesizeSpeech(
          transcript,
          character.openai_voice as OpenAiVoice,
          CARTOON_SPEED
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

        // RE-TIME THE CAPTIONS TO THE CARTOON VOICE.
        //
        // The captions burned along the bottom of the video are driven by
        // word_timings, which up to this point describe the USER's recording.
        // A cartoon prayer doesn't play that recording — it plays the TTS
        // above, which speaks the same words at a completely different pace.
        // Reusing the original timings would drift further out of sync with
        // every sentence.
        //
        // So transcribe the synthesized audio and overwrite the timings with
        // ones that actually match what will be heard. The transcript itself
        // is deliberately NOT overwritten: Whisper on the user's own voice is
        // the authoritative record of what they said, and re-transcribing
        // synthetic speech could quietly corrupt it.
        const cartoonTiming = await transcribeAudio(
          cartoonAudioBuffer,
          "cartoon.mp3"
        );
        if (cartoonTiming.words.length > 0 || cartoonTiming.segments.length > 0) {
          const { error: timingError } = await supabase
            .from("prayers")
            .update({
              captions: cartoonTiming.segments,
              word_timings: cartoonTiming.words,
            })
            .eq("id", id);
          if (timingError) throw timingError;
        }
      } catch (cartoonErr) {
        console.error(
          "Cartoon voice synthesis failed (continuing without it):",
          cartoonErr
        );
      }
    }

    // NARRATION FOR A TYPED PRAYER.
    //
    // A recorded prayer already has a voice. A typed one has none, so one
    // is synthesized here and stored as its own 'narration_audio' asset,
    // which the render worker prefers over raw_audio (see the audioTypes
    // chain in worker/index.js).
    //
    // Skipped entirely when a cartoon character is set: that branch above
    // has already synthesized the character's voice, and rendering both
    // would mean paying for two TTS calls to throw one away.
    //
    // Best-effort, like the cartoon branch: a prayer that fails synthesis
    // still exists and can be retried from its detail page.
    // Only the narrator mode synthesizes anything. 'self' already has the
    // user's own recording, and 'none' is silent by design — paying for TTS
    // in either case would produce audio nothing ever plays.
    if (
      !audioAsset &&
      !prayer.cartoon_character_id &&
      narrationMode === "narrator"
    ) {
      try {
        const voice = (prayer.narrator_voice || "alloy") as OpenAiVoice;
        const narrationBuffer = await synthesizeSpeech(transcript, voice);

        const narrationPath = `${user.id}/${id}/narration.mp3`;
        const { error: narrationUploadError } = await supabase.storage
          .from("prayer-audio")
          .upload(narrationPath, narrationBuffer, {
            contentType: "audio/mpeg",
            upsert: true,
          });
        if (narrationUploadError) throw narrationUploadError;

        const { data: narrationPublicUrl } = supabase.storage
          .from("prayer-audio")
          .getPublicUrl(narrationPath);

        const { error: narrationAssetError } = await supabase
          .from("media_assets")
          .insert({
            prayer_id: id,
            type: "narration_audio",
            storage_url: narrationPublicUrl.publicUrl,
          });
        if (narrationAssetError) throw narrationAssetError;

        // The captions have to follow the narrator's pace, and nothing so
        // far knows what that is — a typed prayer never went through
        // Whisper, so captions/word_timings are still empty. Transcribing
        // the synthesized audio is what produces them. The transcript
        // itself is deliberately NOT overwritten: the user's own words are
        // authoritative, and speech-to-text on synthetic speech could only
        // corrupt them.
        const narrationTiming = await transcribeAudio(
          narrationBuffer,
          "narration.mp3"
        );
        if (
          narrationTiming.words.length > 0 ||
          narrationTiming.segments.length > 0
        ) {
          const { error: timingError } = await supabase
            .from("prayers")
            .update({
              captions: narrationTiming.segments,
              word_timings: narrationTiming.words,
            })
            .eq("id", id);
          if (timingError) throw timingError;
        }
      } catch (narrationErr) {
        console.error("Narration synthesis failed:", narrationErr);
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

    return NextResponse.json({
      transcript,
      theme,
      title,
      captions: segments,
      words,
      musicCategory: chosenMusicCategory,
      visualCategory: chosenVisualCategory,
    });
  } catch (err) {
    console.error("Prayer processing failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 }
    );
  }
}

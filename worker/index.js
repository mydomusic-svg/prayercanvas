// PrayerCanvas render worker (Sprint 3).
//
// Polls Supabase for pending render_jobs, and for each one:
//   1. downloads the prayer's raw audio
//   2. generates a vertical background video themed by the chosen style,
//      with the title and Whisper-timed captions burned in — highlighting
//      one word at a time in sync with the speech (Sprint 3.6) when
//      word-level timestamps are available, falling back to whole-sentence
//      captions (Sprint 2) for older prayers that don't have them
//   3. muxes the original voice recording as the audio track
//   4. uploads the finished MP4 to Supabase Storage and marks the job complete
//
// Background video + music per style come from the `styles` table
// (visual_asset / music_asset columns), seeded by scripts/seed-style-assets.mjs
// with real licensed clips (Pexels video, incompetech.com music — see
// /credits in the app). Falls back to a procedural solid-color background
// and no music bed for any style that hasn't been seeded yet.
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: POLL_INTERVAL_MS (default 5000)

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const VIDEO_BUCKET = "prayer-videos";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

// Procedural background theme per style — no stock assets required.
const STYLE_THEMES = {
  nature: { bg: "0x2f4a3e", text: "white" },
  cinematic: { bg: "0x161616", text: "white" },
  minimal: { bg: "0xf5f5f0", text: "black" },
  celebration: { bg: "0xb5482a", text: "white" },
  scripture: { bg: "0x2e1f47", text: "white" },
  peaceful: { bg: "0x24425c", text: "white" },
};
const DEFAULT_THEME = { bg: "0x2f4a3e", text: "white" };

async function main() {
  console.log("PrayerCanvas render worker started.");
  for (;;) {
    let handled = false;
    try {
      handled = await processNextJob();
    } catch (err) {
      console.error("Unexpected error in poll loop:", err);
    }
    if (!handled) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processNextJob() {
  const { data: job, error } = await supabase
    .from("render_jobs")
    .select("id, prayer_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to poll render_jobs:", error.message);
    return false;
  }
  if (!job) return false;

  console.log(`Picked up render job ${job.id} for prayer ${job.prayer_id}`);
  const workDir = await mkdtemp(path.join(tmpdir(), "prayercanvas-"));

  try {
    await updateJob(job.id, { status: "processing", progress: 5 });
    await renderPrayer(job, workDir);
  } catch (err) {
    console.error(`Render job ${job.id} failed:`, err);
    await updateJob(job.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  return true;
}

async function renderPrayer(job, workDir) {
  const { data: prayer, error: prayerError } = await supabase
    .from("prayers")
    .select("id, user_id, title, recipient_name, captions, word_timings, style_id")
    .eq("id", job.prayer_id)
    .single();
  if (prayerError || !prayer) {
    throw new Error(`Could not load prayer: ${prayerError?.message}`);
  }

  let styleName = null;
  let visualAssetUrl = null;
  let musicAssetUrl = null;
  if (prayer.style_id) {
    const { data: style } = await supabase
      .from("styles")
      .select("name, visual_asset, music_asset")
      .eq("id", prayer.style_id)
      .maybeSingle();
    styleName = style?.name ?? null;
    // Only real uploaded assets are usable — 0001_init.sql seeds these
    // columns with placeholder filenames (e.g. "nature-loop.mp4") until
    // scripts/seed-style-assets.mjs replaces them with real Storage URLs.
    if (style?.visual_asset?.startsWith("http")) visualAssetUrl = style.visual_asset;
    if (style?.music_asset?.startsWith("http")) musicAssetUrl = style.music_asset;
  }
  const theme =
    STYLE_THEMES[(styleName ?? "").toLowerCase()] ?? DEFAULT_THEME;

  const { data: audioAsset, error: audioError } = await supabase
    .from("media_assets")
    .select("storage_url")
    .eq("prayer_id", prayer.id)
    .eq("type", "raw_audio")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (audioError || !audioAsset) {
    throw new Error("No raw audio found for this prayer.");
  }

  await updateJob(job.id, { progress: 15 });

  const audioPath = path.join(workDir, "audio.webm");
  await downloadFile(audioAsset.storage_url, audioPath);

  const duration = await getAudioDuration(audioPath);
  if (!duration || duration <= 0) {
    throw new Error("Could not determine audio duration.");
  }

  await updateJob(job.id, { progress: 30 });

  const title =
    prayer.title ||
    (prayer.recipient_name ? `A Prayer for ${prayer.recipient_name}` : "A Prayer");
  const titlePath = path.join(workDir, "title.txt");
  await writeFile(titlePath, title, "utf8");

  const captions = Array.isArray(prayer.captions) ? prayer.captions : [];
  const captionFiles = [];
  for (let i = 0; i < captions.length; i++) {
    const capPath = path.join(workDir, `cap-${i}.txt`);
    await writeFile(capPath, captions[i].text ?? "", "utf8");
    captionFiles.push({ path: capPath, start: captions[i].start, end: captions[i].end });
  }

  // Word-level timestamps (Sprint 3.6) let us highlight the exact word being
  // spoken, karaoke-style, instead of just showing a whole sentence at once.
  // Older prayers rendered before this feature won't have word_timings —
  // buildFilterComplex falls back to the plain per-segment captions above
  // when this array is empty.
  //
  // Whisper's raw per-word windows are frequently far too short to render or
  // read: many are 20-40ms, and some have start === end (zero width). At
  // 30fps a frame lands every ~33ms, so a sub-33ms window can fall between
  // two sampled frames and never actually appear on screen — which is
  // exactly what was happening. We stretch every word to a minimum on-screen
  // duration, capped so it never overlaps into the next word's own start.
  const MIN_WORD_DISPLAY_SECONDS = 0.35;
  const words = Array.isArray(prayer.word_timings) ? prayer.word_timings : [];
  const wordFiles = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const start = word.start;
    const nextStart = i + 1 < words.length ? words[i + 1].start : Infinity;
    const desiredEnd = Math.max(word.end, start + MIN_WORD_DISPLAY_SECONDS);
    const end = Math.max(Math.min(desiredEnd, nextStart), start + 0.05);

    const wordPath = path.join(workDir, `word-${i}.txt`);
    await writeFile(wordPath, (word.word ?? "").trim(), "utf8");
    wordFiles.push({ path: wordPath, start, end });
  }

  // Download the real background video / music for this style, if the
  // `styles` row has been seeded with them (see scripts/seed-style-assets.mjs).
  // Falls back to the Sprint 3 procedural solid-color background and no
  // music bed when a style hasn't been seeded yet.
  let backgroundVideoPath = null;
  if (visualAssetUrl) {
    backgroundVideoPath = path.join(workDir, "background.mp4");
    await downloadFile(visualAssetUrl, backgroundVideoPath);
  }
  let musicPath = null;
  if (musicAssetUrl) {
    musicPath = path.join(workDir, "music.mp3");
    await downloadFile(musicAssetUrl, musicPath);
  }

  await updateJob(job.id, { progress: 40 });

  const outputPath = path.join(workDir, "output.mp4");
  const filterComplex = buildFilterComplex({
    theme,
    titlePath,
    captionFiles,
    wordFiles,
    hasBackgroundVideo: Boolean(backgroundVideoPath),
    hasMusic: Boolean(musicPath),
  });

  await updateJob(job.id, { progress: 45 });

  const inputArgs = backgroundVideoPath
    ? // Loop the clip indefinitely and cut it to the voice audio's length —
      // real clips (5-20s) are almost always shorter than a full prayer.
      ["-stream_loop", "-1", "-i", backgroundVideoPath, "-t", duration.toFixed(2)]
    : ["-f", "lavfi", "-i", `color=c=${theme.bg}:s=1080x1920:d=${duration.toFixed(2)}:r=30`];

  const audioInputArgs = ["-i", audioPath];
  if (musicPath) {
    // Loop the music bed too, ducked under the voice via the volume filter
    // in buildFilterComplex rather than here.
    audioInputArgs.push("-stream_loop", "-1", "-i", musicPath, "-t", duration.toFixed(2));
  }

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputArgs,
    ...audioInputArgs,
    "-filter_complex", filterComplex,
    "-map", "[vfinal]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    outputPath,
  ]);

  await updateJob(job.id, { progress: 80 });

  const outputBuffer = await readFile(outputPath);
  const storagePath = `${prayer.user_id}/${prayer.id}/render.mp4`;

  const { error: uploadError } = await supabase.storage
    .from(VIDEO_BUCKET)
    .upload(storagePath, outputBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`Failed to upload rendered video: ${uploadError.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(VIDEO_BUCKET)
    .getPublicUrl(storagePath);

  await supabase.from("media_assets").insert({
    prayer_id: prayer.id,
    type: "rendered_video",
    storage_url: publicUrlData.publicUrl,
    duration,
  });

  await updateJob(job.id, {
    status: "complete",
    progress: 100,
    output_url: publicUrlData.publicUrl,
    completed_at: new Date().toISOString(),
  });

  console.log(`Render job ${job.id} complete: ${publicUrlData.publicUrl}`);
}

/**
 * Builds an ffmpeg filter_complex string that draws the title (for the
 * whole video) and each caption segment (only while it's active) over the
 * generated background, using textfile= so we never have to hand-escape
 * arbitrary prayer text for ffmpeg's filter syntax.
 */
function buildFilterComplex({
  theme,
  titlePath,
  captionFiles,
  wordFiles = [],
  hasBackgroundVideo = false,
  hasMusic = false,
}) {
  const filters = [];
  let currentLabel = "0:v";

  // Real clips come in whatever aspect ratio Pexels shipped them in — scale
  // to fill a 1080x1920 frame and center-crop the rest, same treatment a
  // portrait-video editor would apply. The lavfi color fallback is already
  // exactly 1080x1920, so it skips this step.
  if (hasBackgroundVideo) {
    filters.push(
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1,fps=30[bg]`
    );
    currentLabel = "bg";
  }

  let nextLabel = "v0";

  filters.push(
    `[${currentLabel}]drawtext=textfile='${titlePath}':fontfile='${FONT_BOLD}':fontsize=64:fontcolor=${theme.text}:` +
      `x=(w-text_w)/2:y=140:line_spacing=10[${nextLabel}]`
  );
  currentLabel = nextLabel;

  // Prefer word-level highlighting (Sprint 3.6): one word on screen at a
  // time, in a gold highlight box, exactly timed to Whisper's per-word
  // timestamps — the caption tracks the speech instead of showing a whole
  // sentence at once. The box also guarantees contrast against real stock
  // footage backgrounds, which vary a lot in brightness. Older prayers
  // rendered before word_timings existed fall back to the plain per-segment
  // caption line.
  if (wordFiles.length > 0) {
    wordFiles.forEach((word, i) => {
      nextLabel = `v${i + 1}`;
      filters.push(
        `[${currentLabel}]drawtext=textfile='${word.path}':fontfile='${FONT_BOLD}':fontsize=58:fontcolor=white:` +
          `box=1:boxcolor=0xf5b301@0.85:boxborderw=18:` +
          `x=(w-text_w)/2:y=h-380:enable='between(t,${word.start},${word.end})'[${nextLabel}]`
      );
      currentLabel = nextLabel;
    });
  } else {
    captionFiles.forEach((cap, i) => {
      nextLabel = `v${i + 1}`;
      filters.push(
        `[${currentLabel}]drawtext=textfile='${cap.path}':fontfile='${FONT_REGULAR}':fontsize=48:fontcolor=${theme.text}:` +
          `x=(w-text_w)/2:y=h-380:enable='between(t,${cap.start},${cap.end})'[${nextLabel}]`
      );
      currentLabel = nextLabel;
    });
  }

  // Rename the last stage's output to the fixed label we map from.
  const lastFilterIndex = filters.length - 1;
  filters[lastFilterIndex] = filters[lastFilterIndex].replace(
    /\[[^[\]]+\]$/,
    "[vfinal]"
  );

  // Audio: voice is input 1 always. Music, when present, is input 2 — duck
  // it well under the voice (18%) and mix rather than replace, so the
  // prayer itself always stays clearly audible.
  if (hasMusic) {
    filters.push(`[2:a]volume=0.18[music]`);
    // normalize=0: amix defaults to auto-scaling every input down by 1/N,
    // which would quietly halve the voice track on top of our explicit
    // music duck above — disable that so only our 0.18 ducking applies.
    filters.push(
      `[1:a][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`
    );
  } else {
    filters.push(`[1:a]anull[aout]`);
  }

  return filters.join(";");
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
}

async function getAudioDuration(audioPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    audioPath,
  ]);
  return parseFloat(stdout.trim());
}

async function updateJob(id, fields) {
  const { error } = await supabase.from("render_jobs").update(fields).eq("id", id);
  if (error) {
    console.error(`Failed to update render_jobs ${id}:`, error.message);
  }
}

main();

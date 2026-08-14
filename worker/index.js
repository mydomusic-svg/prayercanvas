// PrayerCanvas render worker (Sprint 3).
//
// Polls Supabase for pending render_jobs, and for each one:
//   1. downloads the prayer's raw audio
//   2. generates a vertical background video themed by the chosen style,
//      with the title and Whisper-timed captions (from Sprint 2) burned in
//   3. muxes the original voice recording as the audio track
//   4. uploads the finished MP4 to Supabase Storage and marks the job complete
//
// No external stock footage or music is used — the background is generated
// procedurally with ffmpeg (solid color + vignette) so there's nothing to
// license or source. Swapping in real background loops / music beds per
// style is a natural follow-up once you have licensed assets to drop in.
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
    .select("id, user_id, title, recipient_name, captions, style_id")
    .eq("id", job.prayer_id)
    .single();
  if (prayerError || !prayer) {
    throw new Error(`Could not load prayer: ${prayerError?.message}`);
  }

  let styleName = null;
  if (prayer.style_id) {
    const { data: style } = await supabase
      .from("styles")
      .select("name")
      .eq("id", prayer.style_id)
      .maybeSingle();
    styleName = style?.name ?? null;
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

  const outputPath = path.join(workDir, "output.mp4");
  const filterComplex = buildFilterComplex({
    theme,
    titlePath,
    captionFiles,
  });

  await updateJob(job.id, { progress: 45 });

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${theme.bg}:s=1080x1920:d=${duration.toFixed(2)}:r=30`,
    "-i", audioPath,
    "-filter_complex", filterComplex,
    "-map", "[vfinal]",
    "-map", "1:a",
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
function buildFilterComplex({ theme, titlePath, captionFiles }) {
  const filters = [];
  let currentLabel = "0:v";
  let nextLabel = "v0";

  filters.push(
    `[${currentLabel}]drawtext=textfile='${titlePath}':fontfile='${FONT_BOLD}':fontsize=64:fontcolor=${theme.text}:` +
      `x=(w-text_w)/2:y=140:line_spacing=10[${nextLabel}]`
  );
  currentLabel = nextLabel;

  captionFiles.forEach((cap, i) => {
    nextLabel = `v${i + 1}`;
    filters.push(
      `[${currentLabel}]drawtext=textfile='${cap.path}':fontfile='${FONT_REGULAR}':fontsize=48:fontcolor=${theme.text}:` +
        `x=(w-text_w)/2:y=h-380:enable='between(t,${cap.start},${cap.end})'[${nextLabel}]`
    );
    currentLabel = nextLabel;
  });

  // Rename the last stage's output to the fixed label we map from.
  const lastFilterIndex = filters.length - 1;
  filters[lastFilterIndex] = filters[lastFilterIndex].replace(
    /\[[^[\]]+\]$/,
    "[vfinal]"
  );

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

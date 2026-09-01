// PrayerCanvas render worker (Sprint 3).
//
// Polls Supabase for pending render_jobs, and for each one:
//   1. downloads the prayer's raw audio
//   2. generates a vertical background video themed by the chosen style,
//      with the title and Whisper-timed captions burned in — highlighting
//      one word at a time in sync with the speech (Sprint 3.6) when
//      word-level timestamps are available, falling back to whole-sentence
//      captions (Sprint 2) for older prayers that don't have them
//   3. muxes the original voice recording as the audio track — run through
//      a light compressor + touch of reverb (see buildFilterComplex) —
//      applied to every render, not opt-in
//   4. uploads the finished MP4 to Supabase Storage and marks the job complete
//
// Background video + music per style come from the `styles` table
// (visual_asset / music_asset columns), seeded by scripts/seed-style-assets.mjs
// with real licensed clips (Pexels video, incompetech.com music — see
// /credits in the app). Falls back to a procedural solid-color background
// and no music bed for any style that hasn't been seeded yet.
//
// Alternatively, a prayer can carry its own uploaded photo instead of a
// library style (`prayers.photo_asset_url` — see 0012_photo_upload.sql and
// the "Upload your own photo" tile on the create page). When set, it takes
// priority over any style video: generateKenBurnsClip() turns the still
// photo into a short pan/zoom video first, which then flows through the
// exact same pipeline a library style's video would.
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

// Rendered videos are the single biggest thing this app stores, so they are
// not kept forever. A free-tier user's video is deleted this many hours
// after it finished rendering; paid plans are exempt (see runRetentionSweep).
// Override per-environment without a redeploy via Railway variables.
const FREE_VIDEO_RETENTION_HOURS = Number(
  process.env.FREE_VIDEO_RETENTION_HOURS ?? 24
);
// How often the sweep runs. It is cheap (one indexed query most of the
// time) but there is no reason to run it on every 5-second poll.
const RETENTION_SWEEP_INTERVAL_MS = Number(
  process.env.RETENTION_SWEEP_INTERVAL_MS ?? 60 * 60 * 1000
);
// Belt-and-braces: a bug in the query below should never be able to wipe
// the whole library in one pass. If a sweep ever wants to delete more than
// this many prayers at once, it does this many and leaves the rest for the
// next run — which also gives a human a chance to notice.
const RETENTION_SWEEP_MAX_PRAYERS = 200;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
// Bundled (not from apt — see worker/fonts/) so the title/thumbnail can
// look like an actual designed prayer card instead of plain DejaVu text.
const FONT_CALLIGRAPHY = path.join(
  import.meta.dirname,
  "fonts/GreatVibes-Regular.ttf"
);
const FONT_SERIF = path.join(
  import.meta.dirname,
  "fonts/PlayfairDisplay-Regular.ttf"
);
// Small brand watermark burned into every rendered video and thumbnail
// (bottom-right corner, semi-transparent) — same mark used in the app's own
// header/login screens (public/logo-mark.png), copied into the worker image
// via worker/brand/ so a render is unambiguously "from PrayerMessenger"
// even once it's downloaded and shared outside the app (e.g. re-posted to
// social media with no link back to the site).
const WATERMARK_PATH = path.join(import.meta.dirname, "brand/logo-mark.png");
// Text-style presets — chosen by the user on the create page before
// rendering, so the title (both in-video and on the thumbnail) can look
// intentional rather than always defaulting to the calligraphy look.
const FONT_MODERN = path.join(
  import.meta.dirname,
  "fonts/Montserrat-ExtraBold.ttf"
);
const FONT_HANDWRITTEN = path.join(
  import.meta.dirname,
  "fonts/Caveat-Bold.ttf"
);

// Procedural background theme per style — no stock assets required.
const STYLE_THEMES = {
  nature: { bg: "0x2f4a3e", text: "white", accent: "0xf5c451" },
  cinematic: { bg: "0x161616", text: "white", accent: "0xf5c451" },
  minimal: { bg: "0xf5f5f0", text: "black", accent: "0x9c6b12" },
  celebration: { bg: "0xb5482a", text: "white", accent: "0xffe066" },
  scripture: { bg: "0x2e1f47", text: "white", accent: "0xf5c451" },
  peaceful: { bg: "0x24425c", text: "white", accent: "0xf5c451" },
};
const DEFAULT_THEME = { bg: "0x2f4a3e", text: "white", accent: "0xf5c451" };

// Title font per text style, plus the sizing/wrapping each font needs to
// look right — Caveat and Montserrat read very differently from the
// calligraphy script at the same pixel size, so each preset tunes its own.
// Sizes/outline (titleBorderW) tuned after a real render came back with the
// title nearly invisible: light accent colors (gold/sky/ivory) have almost
// no contrast on their own against a light/foggy background clip. A dark
// outline + drop shadow guarantees the title reads regardless of accent
// color or background brightness.
const TEXT_STYLES = {
  calligraphy: {
    font: FONT_CALLIGRAPHY,
    videoFontSize: 72,
    videoWrapChars: 18,
    thumbFontSize: 84,
    thumbWrapChars: 17,
    titleBorderW: 5,
    uppercase: false,
  },
  modern: {
    font: FONT_MODERN,
    videoFontSize: 50,
    videoWrapChars: 14,
    thumbFontSize: 56,
    thumbWrapChars: 13,
    titleBorderW: 3,
    uppercase: true,
  },
  handwritten: {
    font: FONT_HANDWRITTEN,
    videoFontSize: 78,
    videoWrapChars: 17,
    thumbFontSize: 88,
    thumbWrapChars: 16,
    titleBorderW: 4,
    uppercase: false,
  },
};
const DEFAULT_TEXT_STYLE = TEXT_STYLES.calligraphy;

// Accent color choices offered on the create page — applied to the title in
// both the video and its thumbnail. Curated (rather than a free color
// picker) so every combination still reads clearly against every theme.
const ACCENT_COLORS = {
  gold: "0xf5c451",
  rose: "0xe98a9c",
  sky: "0x8ecae6",
  sage: "0x8fbf8f",
  ivory: "0xffffff",
};

// Railway sends SIGTERM to the old container during a rolling deploy and
// expects it to exit. Without a handler, Node's default SIGTERM behavior
// SHOULD terminate the process — but if that's ever swallowed (e.g. by a
// dangling async operation keeping the event loop alive), an old-code
// container can keep polling forever, racing the new container for the
// same jobs and non-deterministically processing some of them with stale
// code. Handling the signal explicitly and forcing an exit removes any
// ambiguity — this is likely the reason fixes have appeared to
// "intermittently" not take effect even after a clean, correct redeploy.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down.`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function main() {
  console.log(
    "PrayerCanvas render worker started. [build: audio-duration-fallback-v1]"
  );
  for (;;) {
    if (shuttingDown) return;
    let handled = false;
    try {
      await maybeRunRetentionSweep();
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

/**
 * Deletes a prayer's rendered video + thumbnail objects from Storage.
 *
 * Every render writes to render-{jobId}.mp4 / thumbnail-{jobId}.jpg — a
 * fresh filename per job, done deliberately so a re-render can never be
 * served a stale cached copy under a URL that already exists. The cost of
 * that choice is that nothing ever cleaned up the PREVIOUS render, so
 * re-rendering a prayer five times left five full videos in the bucket with
 * only the newest reachable. This is what collects them.
 *
 * Pass keepJobId to leave the current render in place (the re-render case);
 * omit it to remove everything for that prayer (the retention case).
 *
 * Rather than reconstructing filenames from job ids, this lists the prayer's
 * folder and deletes what is actually there — so renders orphaned before
 * this function existed get cleaned up too.
 */
async function deletePrayerVideoFiles(userId, prayerId, keepJobId = null) {
  const folder = `${userId}/${prayerId}`;
  const { data: files, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .list(folder, { limit: 1000 });
  if (error) {
    console.error(`Could not list ${folder}: ${error.message}`);
    return 0;
  }
  if (!files || files.length === 0) return 0;

  const keep = keepJobId
    ? [`render-${keepJobId}.mp4`, `thumbnail-${keepJobId}.jpg`]
    : [];
  const doomed = files
    .map((f) => f.name)
    .filter((n) => !keep.includes(n))
    .map((n) => `${folder}/${n}`);

  if (doomed.length === 0) return 0;

  const { error: rmError } = await supabase.storage
    .from(VIDEO_BUCKET)
    .remove(doomed);
  if (rmError) {
    console.error(`Could not delete ${doomed.length} file(s): ${rmError.message}`);
    return 0;
  }
  return doomed.length;
}

let lastRetentionSweepAt = 0;

/**
 * Deletes rendered videos belonging to free-tier users once they are older
 * than FREE_VIDEO_RETENTION_HOURS. Paid accounts are exempt and keep theirs
 * indefinitely.
 *
 * IMPORTANT, by design: this deletes the VIDEO FILES only. The prayer row,
 * its transcript, captions and the original recording all stay, so nothing
 * the user actually wrote or said is lost, the prayer still appears in their
 * dashboard, and it can be re-rendered on demand. Deleting the prayer itself
 * would make expiry destructive and unrecoverable; deleting just the render
 * reclaims essentially all of the storage (an MP4 dwarfs a row of text)
 * while staying reversible.
 *
 * Plan lookup is deliberately fail-safe: if users.plan cannot be read for
 * any reason, that user is treated as PAID and skipped. Failing to delete
 * is a storage cost; wrongly deleting a paying customer's video is not
 * recoverable.
 */
async function runRetentionSweep() {
  const cutoff = new Date(
    Date.now() - FREE_VIDEO_RETENTION_HOURS * 3600 * 1000
  ).toISOString();

  const { data: jobs, error } = await supabase
    .from("render_jobs")
    .select("id, prayer_id, completed_at")
    .eq("status", "complete")
    .not("output_url", "is", null)
    .lt("completed_at", cutoff)
    .order("completed_at", { ascending: true })
    .limit(RETENTION_SWEEP_MAX_PRAYERS);

  if (error) {
    console.error(`Retention sweep: could not query render_jobs: ${error.message}`);
    return;
  }
  if (!jobs || jobs.length === 0) return;

  // Resolve each job's owner, then that owner's plan, in two batched
  // queries rather than one per job.
  const prayerIds = [...new Set(jobs.map((j) => j.prayer_id))];
  const { data: prayers, error: prayerError } = await supabase
    .from("prayers")
    .select("id, user_id")
    .in("id", prayerIds);
  if (prayerError || !prayers) {
    console.error(
      `Retention sweep: could not load prayers: ${prayerError?.message}`
    );
    return;
  }
  const ownerOf = new Map(prayers.map((p) => [p.id, p.user_id]));

  const userIds = [...new Set(prayers.map((p) => p.user_id))];
  const paidUsers = new Set();
  const { data: users, error: userError } = await supabase
    .from("users")
    .select("id, plan")
    .in("id", userIds);
  if (userError) {
    // See the fail-safe note above — if plans are unreadable (e.g. the
    // column does not exist yet because billing was never switched on),
    // delete NOTHING rather than risk deleting a paying customer's video.
    console.error(
      `Retention sweep: could not read plans, skipping this sweep: ${userError.message}`
    );
    return;
  }
  for (const u of users ?? []) {
    if (u.plan && u.plan !== "free") paidUsers.add(u.id);
  }

  let deletedFiles = 0;
  let expiredPrayers = 0;

  for (const job of jobs) {
    const userId = ownerOf.get(job.prayer_id);
    if (!userId || paidUsers.has(userId)) continue;

    const removed = await deletePrayerVideoFiles(userId, job.prayer_id);
    deletedFiles += removed;
    expiredPrayers++;

    // Clear the URLs so the app stops advertising a file that is gone. The
    // job row itself is kept as the record that a render happened.
    await supabase
      .from("render_jobs")
      .update({ output_url: null, thumbnail_url: null })
      .eq("id", job.id);

    // Same for the media_assets pointer to the rendered file.
    await supabase
      .from("media_assets")
      .delete()
      .eq("prayer_id", job.prayer_id)
      .eq("type", "rendered_video");
  }

  if (expiredPrayers > 0) {
    console.log(
      `Retention sweep: expired ${expiredPrayers} free-tier prayer video(s), ` +
        `${deletedFiles} file(s) deleted (older than ${FREE_VIDEO_RETENTION_HOURS}h).`
    );
  }
}

async function maybeRunRetentionSweep() {
  if (Date.now() - lastRetentionSweepAt < RETENTION_SWEEP_INTERVAL_MS) return;
  lastRetentionSweepAt = Date.now();
  try {
    await runRetentionSweep();
  } catch (err) {
    console.error("Retention sweep failed:", err);
  }
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
    .select(
      "id, user_id, title, recipient_name, include_recipient_in_title, transcript, captions, word_timings, style_id, music_style_id, photo_asset_url, text_style, accent_color, cartoon_character_id"
    )
    .eq("id", job.prayer_id)
    .single();
  if (prayerError || !prayer) {
    throw new Error(`Could not load prayer: ${prayerError?.message}`);
  }

  // Funny Cartoon category (0015_cartoon_characters.sql): when set, the
  // video shows just the character's portrait (no on-screen prayer text —
  // see the cartoonMode branches in buildFilterComplex/generateThumbnail
  // below) and is voiced by an AI TTS track instead of the user's own
  // recording.
  let cartoonCharacter = null;
  if (prayer.cartoon_character_id) {
    const { data: character, error: characterError } = await supabase
      .from("cartoon_characters")
      .select("image_asset, video_asset, pitch_ratio, voice_effect")
      .eq("id", prayer.cartoon_character_id)
      .maybeSingle();
    if (characterError || !character) {
      throw new Error(
        `Could not load cartoon character: ${characterError?.message ?? "not found"}`
      );
    }
    cartoonCharacter = character;
  }
  const cartoonMode = Boolean(cartoonCharacter);

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
    // The style's own music_asset is now only a fallback — see below.
    if (style?.music_asset?.startsWith("http")) musicAssetUrl = style.music_asset;
  }

  // Music is now chosen independently of the visual style (0010_music_
  // styles.sql) — prayers created before that migration have no
  // music_style_id, so they keep using their style's bundled track above.
  if (prayer.music_style_id) {
    const { data: musicStyle } = await supabase
      .from("music_styles")
      .select("music_asset")
      .eq("id", prayer.music_style_id)
      .maybeSingle();
    if (musicStyle?.music_asset?.startsWith("http")) {
      musicAssetUrl = musicStyle.music_asset;
    }
  }
  const theme =
    STYLE_THEMES[(styleName ?? "").toLowerCase()] ?? DEFAULT_THEME;
  const textStyle = TEXT_STYLES[prayer.text_style] ?? DEFAULT_TEXT_STYLE;
  const accentColor = ACCENT_COLORS[prayer.accent_color] ?? theme.accent;

  // WHICH AUDIO GETS RENDERED, in order of preference:
  //
  //   cartoon_audio   the character's AI voice (Funny Cartoon category)
  //   narration_audio a narrator reading a typed/pasted prayer (0020)
  //   raw_audio       the user's own recording
  //
  // All three are produced by the process route and stored side by side, so
  // the fallbacks matter: if synthesis failed for a cartoon or typed
  // prayer, a prayer that HAS a recording still renders with the real
  // voice rather than failing outright. cartoon_audio is only considered
  // in cartoon mode so a character's voice can never leak into a prayer
  // whose character was later cleared.
  const audioTypes = [
    ...(cartoonMode ? ["cartoon_audio"] : []),
    "narration_audio",
    "raw_audio",
  ];
  let audioAsset = null;
  let audioAssetError = null;
  for (const type of audioTypes) {
    const { data, error } = await supabase
      .from("media_assets")
      .select("storage_url")
      .eq("prayer_id", prayer.id)
      .eq("type", type)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    audioAssetError = audioAssetError ?? error;
    if (data) {
      audioAsset = data;
      break;
    }
  }
  if (!audioAsset) {
    throw new Error(`No audio found for this prayer: ${audioAssetError?.message ?? ""}`);
  }

  await updateJob(job.id, { progress: 15 });

  // The local filename's extension has to match the real container —
  // iPhone recordings upload as raw.mp4 (or .aac) rather than .webm (see
  // the mimeType fix in create/page.tsx), and ffmpeg/ffprobe's format
  // auto-detection isn't 100% reliable for every container without a
  // matching extension hint, especially raw ADTS AAC streams. Hardcoding
  // ".webm" here regardless of the actual upload was silently breaking
  // duration detection (and the render itself) for iPhone-recorded
  // prayers.
  let audioExt = ".webm";
  try {
    audioExt = path.extname(new URL(audioAsset.storage_url).pathname) || ".webm";
  } catch {
    // Malformed URL is unexpected but shouldn't crash the render — fall
    // back to the old default extension.
  }
  const audioPath = path.join(workDir, `audio${audioExt}`);
  await downloadFile(audioAsset.storage_url, audioPath);

  const duration = await getAudioDuration(audioPath);
  if (!duration || duration <= 0) {
    throw new Error("Could not determine audio duration.");
  }

  await updateJob(job.id, { progress: 30 });

  // Title is burned directly into the video (and thumbnail) again — an
  // earlier version of this pipeline made it a live page/player overlay
  // instead, purely as text, so it could be edited/reshared without
  // re-rendering. But a recipient who receives the video as a native file
  // (AirDropped, texted, downloaded — not opened through the app's own
  // pages) never sees any of that HTML; they only ever see the actual video
  // pixels. Since that's the common real-world path prayers get shared
  // through, the title/prayer text need to actually be part of the video
  // itself to show up there at all. Reusing/resharing a rendered video with
  // a different recipient does mean re-rendering it — that's the tradeoff.
  // The recipient's name only shows up here if the user explicitly opted in
  // at creation time (include_recipient_in_title) — off by default, since
  // most prayers get shared with whoever the user likes, not just the one
  // person named at creation (see 0013 migration).
  const title =
    prayer.title ||
    (prayer.include_recipient_in_title && prayer.recipient_name
      ? `A Prayer for ${prayer.recipient_name}`
      : "A Prayer");
  const titlePath = path.join(workDir, "title.txt");
  const displayTitle = textStyle.uppercase ? title.toUpperCase() : title;
  // Long titles at fontsize 64 easily exceed the 1080px frame width, which
  // pushes drawtext's centering x=(w-text_w)/2 negative and clips both
  // edges (seen in production — "Abundance Flows Through Your Work" only
  // showed "ndance Flows Through Your W"). Wrap greedily onto multiple
  // centered lines instead of shrinking to illegibility. The wrap width is
  // per text-style since each title font has a different average glyph
  // width at its own font size.
  const wrappedTitle = wrapText(displayTitle, textStyle.videoWrapChars);
  await writeFile(titlePath, wrappedTitle, "utf8");
  // Long titles wrap onto 3+ lines (e.g. "Bryan, Your Wonderful Day Awaits"
  // in the calligraphy font at a large size). The opening card's scrim/body
  // used to start at a fixed y regardless of title height, so a tall title
  // ran straight into the body text. buildFilterComplex uses this to push
  // the opening card down by however much room the actual wrapped title
  // needs.
  const titleLineCount = wrappedTitle.split("\n").length;

  // Prayer text card: the prayer text itself, shown with a scrim behind it
  // for the entire video (see buildFilterComplex) — originally shown only
  // for the first few seconds, but that made the text feel like it
  // disappeared partway through, so it now stays up the whole time. Also
  // still what makes the video's own native thumbnail/poster — generated by
  // iMessage, Photos, or any other app from an early video frame, completely
  // outside our control — show the full prayer text "at rest" instead of a
  // blank background frame, matching the in-app thumbnail's look.
  const openingBodyPath = path.join(workDir, "opening-body.txt");
  await writeFile(
    openingBodyPath,
    wrapText(truncateForThumbnail(prayer.transcript ?? "", 260), 26),
    "utf8"
  );

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

  // Background: a user-uploaded photo (0012_photo_upload.sql) takes
  // priority over a library style's video — the create page only lets one
  // be chosen at a time, but prefer the more specific explicit choice
  // defensively in case a prayer somehow has both. Falls back further to
  // the real background video for this style if seeded (see
  // scripts/seed-style-assets.mjs), then to the Sprint 3 procedural
  // solid-color background if neither is set.
  let backgroundVideoPath = null;
  if (cartoonCharacter?.video_asset) {
    // The character has a real animation (0017) — use it directly. It is
    // already 1080x1920 (the seeding script letterboxes the source clip
    // with a blurred fill, since the raw animations are landscape), so the
    // scale/crop step downstream is a no-op on it, and renderPrayer's
    // existing `-stream_loop -1` loops the few seconds of animation to
    // cover however long the prayer runs.
    backgroundVideoPath = path.join(workDir, "character.mp4");
    await downloadFile(cartoonCharacter.video_asset, backgroundVideoPath);
  } else if (cartoonCharacter) {
    // No clip for this character yet — fall back to the still portrait with
    // the same Ken Burns pan/zoom a user's uploaded photo gets, so it isn't
    // completely frozen on screen for the whole video.
    let photoExt = ".png";
    try {
      photoExt = path.extname(new URL(cartoonCharacter.image_asset).pathname) || ".png";
    } catch {
      // Malformed URL is unexpected but shouldn't crash the render.
    }
    const photoPath = path.join(workDir, `character${photoExt}`);
    await downloadFile(cartoonCharacter.image_asset, photoPath);
    backgroundVideoPath = path.join(workDir, "kenburns.mp4");
    await generateKenBurnsClip(photoPath, backgroundVideoPath);
  } else if (prayer.photo_asset_url) {
    let photoExt = ".jpg";
    try {
      photoExt = path.extname(new URL(prayer.photo_asset_url).pathname) || ".jpg";
    } catch {
      // Malformed URL is unexpected but shouldn't crash the render.
    }
    const photoPath = path.join(workDir, `photo${photoExt}`);
    await downloadFile(prayer.photo_asset_url, photoPath);
    backgroundVideoPath = path.join(workDir, "kenburns.mp4");
    await generateKenBurnsClip(photoPath, backgroundVideoPath);
  } else if (visualAssetUrl) {
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
  // Input order (fixed by the order -i flags are given below): 0 = the
  // background video/color, 1 = voice audio, 2 = music (only if present),
  // then the watermark logo image last — whatever index that ends up being
  // is what buildFilterComplex needs to reference it as `[N:v]`.
  const logoInputIndex = musicPath ? 3 : 2;
  const filterComplex = buildFilterComplex({
    theme,
    textStyle,
    accentColor,
    titlePath,
    titleLineCount,
    openingBodyPath,
    captionFiles,
    wordFiles,
    hasBackgroundVideo: Boolean(backgroundVideoPath),
    hasMusic: Boolean(musicPath),
    logoInputIndex,
    cartoonMode,
    pitchRatio: cartoonCharacter?.pitch_ratio ?? 1.0,
    voiceEffect: cartoonCharacter?.voice_effect ?? null,
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

  // Watermark logo input, always last (see logoInputIndex above). -loop 1
  // keeps this single still frame available for the whole render; -shortest
  // on the final ffmpeg call (below) still caps overall output length to
  // the actual voice/video duration, not this otherwise-infinite loop.
  const logoInputArgs = ["-loop", "1", "-i", WATERMARK_PATH];

  // Diagnostic: word/caption counts and filter_complex length, so we can
  // confirm from Railway logs alone whether the word-highlight path was
  // actually taken and whether ffmpeg raised any font/filter warnings —
  // without needing to eyeball the rendered video.
  console.log(
    `Render job ${job.id}: ${wordFiles.length} word file(s), ${captionFiles.length} caption file(s), ` +
      `filter_complex is ${filterComplex.length} chars.`
  );

  try {
    const ffmpegResult = await execFileAsync("ffmpeg", [
      "-y",
      ...inputArgs,
      ...audioInputArgs,
      ...logoInputArgs,
      "-filter_complex", filterComplex,
      "-map", "[vfinal]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      // Sprint 4: tuned for easy sharing (email/MMS/social) rather than
      // ffmpeg's untuned default. CRF 23 (the implicit default when neither
      // -crf nor -b:v is set) produced needlessly large files for content
      // that's mostly a static/looped background with text and captions —
      // very compressible. CRF 28 still looks clean for this content and
      // roughly halves file size; maxrate/bufsize caps the rare high-motion
      // background clip from spiking well past that.
      "-crf", "28",
      "-maxrate", "2500k",
      "-bufsize", "5000k",
      "-pix_fmt", "yuv420p",
      // faststart moves the moov atom to the front so the video can start
      // playing before it's fully downloaded — matters once these are being
      // opened from share-sheet links on mobile data instead of a fast wifi
      // connection in the browser.
      "-movflags", "+faststart",
      "-c:a", "aac",
      // Spoken word doesn't need 192k; 128k is still clean for voice+music
      // and shaves a bit more off the file size.
      "-b:a", "128k",
      // Explicit OUTPUT-level duration cap, not just "-shortest". ffmpeg
      // binds a bare "-t"/"-stream_loop" etc. to whichever "-i" comes NEXT
      // on the command line, not the one before it — so inputArgs'/
      // audioInputArgs' trailing "-t" flags above only ever capped the
      // *following* input (harmlessly redundant, since voice/music are
      // already ~`duration` long). The render was actually being capped by
      // a different accident: with nothing after it, a trailing "-t" with
      // no further "-i" is read as an OUTPUT option instead. Adding the
      // watermark logo as one more input after audioInputArgs put an "-i"
      // after that trailing "-t", silently turning it back into an (again
      // redundant) input option and removing the real cap — the render
      // then ran until something else stopped it instead of stopping at
      // `duration`. An explicit "-t" here doesn't depend on argument order
      // at all, so it can't be broken again by adding another input later.
      "-t", duration.toFixed(2),
      "-shortest",
      outputPath,
    ]);
    const stderrTail = (ffmpegResult.stderr ?? "").slice(-1500);
    console.log(`Render job ${job.id}: ffmpeg stderr tail:\n${stderrTail}`);
  } catch (ffmpegErr) {
    // execFileAsync's rejection only includes a truncated message by
    // default — log the full stderr so a font/filter parse error is
    // actually visible instead of just "Command failed".
    console.error(
      `Render job ${job.id}: ffmpeg failed. stderr:\n${ffmpegErr.stderr ?? ffmpegErr.message}`
    );
    throw ffmpegErr;
  }

  await updateJob(job.id, { progress: 75 });

  // Thumbnail (poster image): a single still frame from the same background,
  // with the title in the chosen accent font and the prayer text in a
  // readable serif underneath a dark/light scrim — so the prayer can be
  // read without pressing play, and the video's own artwork carries into
  // the thumbnail instead of a generic placeholder frame.
  const thumbnailPath = path.join(workDir, "thumbnail.jpg");
  await generateThumbnail({
    workDir,
    theme,
    textStyle,
    accentColor,
    title: displayTitle,
    transcript: prayer.transcript ?? "",
    backgroundVideoPath,
    outputPath: thumbnailPath,
    cartoonMode,
  });

  await updateJob(job.id, { progress: 80 });

  const outputBuffer = await readFile(outputPath);
  // Every render used the exact same storage path before, so the browser
  // (and any CDN in front of Supabase Storage) could keep serving a
  // cached copy of an OLD render under an identical URL — this is a very
  // plausible explanation for "the video looked different/broken on
  // replay" reports even after we fixed the underlying code. Including the
  // job id makes every render's URL unique, so there's nothing stale to
  // ever be served.
  const storagePath = `${prayer.user_id}/${prayer.id}/render-${job.id}.mp4`;

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

  const thumbnailBuffer = await readFile(thumbnailPath);
  const thumbnailStoragePath = `${prayer.user_id}/${prayer.id}/thumbnail-${job.id}.jpg`;
  // Thumbnail uploads have shown an intermittent, transient failure (seen
  // once in production with no other symptoms -- retrying immediately
  // succeeded). Retry a couple of times with a short backoff before giving
  // up. A broken thumbnail still shouldn't fail an otherwise-successful
  // render -- log and continue without one rather than throwing.
  let thumbnailUrl = null;
  let lastThumbnailError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error: thumbnailUploadError } = await supabase.storage
      .from(VIDEO_BUCKET)
      .upload(thumbnailStoragePath, thumbnailBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (!thumbnailUploadError) {
      thumbnailUrl = supabase.storage
        .from(VIDEO_BUCKET)
        .getPublicUrl(thumbnailStoragePath).data.publicUrl;
      lastThumbnailError = null;
      break;
    }
    lastThumbnailError = thumbnailUploadError;
    console.error(
      `Render job ${job.id}: thumbnail upload attempt ${attempt} failed: ${thumbnailUploadError.message}`
    );
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  if (lastThumbnailError) {
    console.error(
      `Render job ${job.id}: thumbnail upload gave up after 3 attempts: ${lastThumbnailError.message}`
    );
  }

  // Now that the new render is safely uploaded and its URL recorded, drop
  // any PREVIOUS render/thumbnail for this prayer. Filenames are unique per
  // job (deliberately, to defeat CDN caching), so without this every
  // re-render left another full MP4 behind in the bucket forever, with only
  // the newest one reachable. Deleting after the successful upload — never
  // before — means a failed render can't destroy the copy the user still
  // has. A failure here is logged, not thrown: leaving a stale file behind
  // is a storage cost, not a reason to fail an otherwise-good render.
  try {
    const removed = await deletePrayerVideoFiles(prayer.user_id, prayer.id, job.id);
    if (removed > 0) {
      console.log(`Render job ${job.id}: cleaned up ${removed} superseded file(s).`);
    }
  } catch (err) {
    console.error(`Render job ${job.id}: cleanup of old renders failed: ${err.message}`);
  }

  // Replace, don't accumulate: the previous rendered_video row points at a
  // file that was just deleted above.
  await supabase
    .from("media_assets")
    .delete()
    .eq("prayer_id", prayer.id)
    .eq("type", "rendered_video");

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
    thumbnail_url: thumbnailUrl,
    completed_at: new Date().toISOString(),
  });

  console.log(`Render job ${job.id} complete: ${publicUrlData.publicUrl}`);
}

/**
 * Renders a single still-frame JPEG "poster" for the prayer: a frame from
 * the same background art (or theme color, for styles without real footage)
 * with the title in the chosen accent font and the prayer text in a
 * readable serif underneath a scrim, so the video is legible without
 * pressing play.
 */
async function generateThumbnail({
  workDir,
  theme,
  textStyle,
  accentColor,
  title,
  transcript,
  backgroundVideoPath,
  outputPath,
  cartoonMode = false,
}) {
  // Funny Cartoon category: the character's portrait IS the thumbnail — no
  // title/body text card drawn over it (see buildFilterComplex's matching
  // cartoonMode branch for why). Keep the background sharp rather than
  // blurred, since there's no text sitting on top of it here that the blur
  // would otherwise be helping read.
  if (cartoonMode) {
    const filters = [];
    if (backgroundVideoPath) {
      filters.push(
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg]`
      );
    } else {
      filters.push(`[0:v]copy[bg]`);
    }
    filters.push(`[1:v]scale=120:-1,format=rgba,colorchannelmixer=aa=0.8[logo]`);
    filters.push(`[bg][logo]overlay=W-w-36:H-h-56[s4]`);
    filters.push(
      `[s4]drawtext=text='PrayerMessenger':fontfile='${FONT_BOLD}':fontsize=28:fontcolor=white@0.85:` +
        `bordercolor=black@0.5:borderw=2:x=w-text_w-36:y=h-196[out]`
    );

    const inputArgs = backgroundVideoPath
      ? ["-ss", "1.5", "-i", backgroundVideoPath]
      : ["-f", "lavfi", "-i", `color=c=${theme.bg}:s=1080x1920:d=1:r=1`];
    inputArgs.push("-i", WATERMARK_PATH);

    await execFileAsync("ffmpeg", [
      "-y",
      ...inputArgs,
      "-filter_complex", filters.join(";"),
      "-map", "[out]",
      "-frames:v", "1",
      "-q:v", "3",
      outputPath,
    ]);
    return;
  }

  const titleLinesPath = path.join(workDir, "thumb-title.txt");
  const wrappedTitle = wrapText(title, textStyle.thumbWrapChars);
  await writeFile(titleLinesPath, wrappedTitle, "utf8");
  const titleLineCount = wrappedTitle.split("\n").length;

  const bodyLinesPath = path.join(workDir, "thumb-body.txt");
  await writeFile(
    bodyLinesPath,
    wrapText(truncateForThumbnail(transcript, 260), 30),
    "utf8"
  );

  // Light themes (e.g. "Minimal") need a light outline so dark accent/body
  // text stays readable; dark themes need a dark outline under white text.
  // (Previously a solid drawbox scrim sat behind the text instead — see the
  // matching change in buildFilterComplex for why that was replaced with a
  // plain text outline + shadow.)
  const bodyBorderColor = theme.text === "black" ? "white@0.85" : "black@0.6";

  // Softly blur the background photo behind the text (like a magazine
  // pull-quote card) rather than leaving it sharp — a real render came back
  // with the resting thumbnail looking cluttered/hard to read against a
  // busy, high-detail background clip. Blur calms that down into a soft,
  // out-of-focus backdrop so the text is what actually reads first, the
  // same effect as the reference "Powerful Morning Prayer" card the user
  // pointed to.
  const BG_BLUR = "gblur=sigma=14";

  // Switched from a plain -vf chain to -filter_complex with labeled pads:
  // the watermark overlay below needs a second input (the logo image), and
  // -vf only supports a single-input filter chain.
  const filters = [];
  let currentLabel = "0:v";
  if (backgroundVideoPath) {
    filters.push(
      `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,${BG_BLUR}[bg]`
    );
    currentLabel = "bg";
  } else {
    // The lavfi solid-color fallback has nothing to blur, but still needs
    // its own labeled pad to feed into the scrim step below.
    filters.push(`[0:v]${BG_BLUR}[bg]`);
    currentLabel = "bg";
  }
  // Keeps the user's picked accent color (personalization) for the title —
  // the dark outline + shadow guarantees legibility regardless of which
  // color was picked or how bright the background photo happens to be.
  filters.push(
    `[${currentLabel}]drawtext=textfile='${titleLinesPath}':fontfile='${textStyle.font}':fontsize=${textStyle.thumbFontSize}:fontcolor=${accentColor}:` +
      `bordercolor=black@0.55:borderw=${textStyle.titleBorderW}:shadowcolor=black@0.35:shadowx=2:shadowy=2:` +
      `line_spacing=6:x=(w-text_w)/2:y=530[s2]`
  );
  // Body text used to start at a fixed y=830 regardless of the title's
  // actual height. A short title left enough clearance, but a long one
  // wrapped onto 3 lines (e.g. a calligraphy-font title at thumbFontSize 84)
  // ran straight into the body — the "Awaits" line overlapping "Heavenly
  // Father, we come to" in a real test render. Push the body down based on
  // the wrapped title's real line count instead of assuming it's always
  // short.
  const TITLE_TOP_Y = 530;
  const titleBlockHeight = titleLineCount * (textStyle.thumbFontSize * 1.25 + 6);
  const bodyY = Math.round(TITLE_TOP_Y + titleBlockHeight + 40);
  filters.push(
    `[s2]drawtext=textfile='${bodyLinesPath}':fontfile='${FONT_SERIF}':fontsize=40:fontcolor=${theme.text}:` +
      `bordercolor=${bodyBorderColor}:borderw=2:shadowcolor=black@0.35:shadowx=2:shadowy=2:` +
      `line_spacing=20:x=(w-text_w)/2:y=${bodyY}[s3]`
  );
  // Same brand watermark as the video itself (icon + spelled-out name — see
  // buildFilterComplex) — input 1 is the logo image, added below.
  filters.push(`[1:v]scale=120:-1,format=rgba,colorchannelmixer=aa=0.8[logo]`);
  filters.push(`[s3][logo]overlay=W-w-36:H-h-56[s4]`);
  filters.push(
    `[s4]drawtext=text='PrayerMessenger':fontfile='${FONT_BOLD}':fontsize=28:fontcolor=white@0.85:` +
      `bordercolor=black@0.5:borderw=2:x=w-text_w-36:y=h-196[out]`
  );

  const inputArgs = backgroundVideoPath
    ? // A couple seconds in tends to avoid a black fade-in frame at t=0.
      ["-ss", "1.5", "-i", backgroundVideoPath]
    : ["-f", "lavfi", "-i", `color=c=${theme.bg}:s=1080x1920:d=1:r=1`];
  inputArgs.push("-i", WATERMARK_PATH);

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputArgs,
    "-filter_complex", filters.join(";"),
    "-map", "[out]",
    "-frames:v", "1",
    "-q:v", "3",
    outputPath,
  ]);
}

// A generated Ken Burns clip only needs to be a handful of seconds — like
// the real stock video clips, it gets looped by the same `-stream_loop -1
// ... -t duration` logic in renderPrayer to fill however long the prayer
// actually is, so there's no need to render one as long as the speech.
const KEN_BURNS_CLIP_SECONDS = 8;
const KEN_BURNS_FPS = 30;

// A handful of pan directions (start-corner/edge -> center-ish), expressed
// as ffmpeg zoompan x/y expressions in terms of the current `zoom` value so
// the pan tracks correctly as the zoom itself animates over the clip.
const KEN_BURNS_PANS = [
  { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" }, // center
  { x: "0", y: "ih/2-(ih/zoom/2)" }, // drift right (start pinned left)
  { x: "iw-(iw/zoom)", y: "ih/2-(ih/zoom/2)" }, // drift left (start pinned right)
  { x: "iw/2-(iw/zoom/2)", y: "0" }, // drift down (start pinned top)
  { x: "iw/2-(iw/zoom/2)", y: "ih-(ih/zoom)" }, // drift up (start pinned bottom)
];

/**
 * Turns a single uploaded photo into a short vertical video with a gentle,
 * randomized pan/zoom (Ken Burns) motion, using ffmpeg's zoompan filter.
 * The randomization (zoom in vs out, and pan direction) is re-rolled on
 * every render, so re-rendering the same prayer doesn't look identical.
 *
 * zoompan's z expression uses `on` (the output frame number) directly with
 * d=1, rather than the more commonly-copied `zoom+0.001`-style incremental
 * expression with d>1 — the latter recomputes zoom in discrete jumps every
 * d frames, which reads as a stepped/jerky motion instead of a smooth pan.
 */
async function generateKenBurnsClip(photoPath, outputPath) {
  const zoomIn = Math.random() < 0.6; // slight bias toward zoom-in — reads better in a portrait frame than zooming out from an already-tight crop
  const startZoom = zoomIn ? 1.0 : 1.25;
  const endZoom = zoomIn ? 1.25 : 1.0;
  const pan = KEN_BURNS_PANS[Math.floor(Math.random() * KEN_BURNS_PANS.length)];

  const totalFrames = KEN_BURNS_CLIP_SECONDS * KEN_BURNS_FPS;
  const zoomExpr = `${startZoom}+(${endZoom - startZoom})*on/${totalFrames}`;

  // Pre-scale well above the 1080x1920 output (1.5x) so zoompan's crop at
  // up to 1.25x zoom still samples from real pixels instead of upscaling a
  // frame that's already at output size — same treatment the real stock
  // video clips get from the scale+crop step in buildFilterComplex, just
  // applied here since a still photo has no such step of its own.
  const vf =
    `scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,` +
    `zoompan=z='${zoomExpr}':d=1:x='${pan.x}':y='${pan.y}':s=1080x1920:fps=${KEN_BURNS_FPS},` +
    `format=yuv420p`;

  await execFileAsync("ffmpeg", [
    "-y",
    "-loop", "1",
    "-i", photoPath,
    "-vf", vf,
    "-t", String(KEN_BURNS_CLIP_SECONDS),
    "-r", String(KEN_BURNS_FPS),
    outputPath,
  ]);
}

/**
 * Truncates transcript text to roughly maxChars, breaking on a word
 * boundary and adding an ellipsis, so a very long prayer's thumbnail text
 * doesn't overflow its scrim.
 */
function truncateForThumbnail(text, maxChars) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`;
}

// Voice presets for the Funny Cartoon category, keyed by the
// cartoon_characters.voice_effect column (0018_cartoon_voice_effect.sql).
//
// `pitch` is the asetrate ratio: above 1 raises the voice, below 1 lowers
// it. Speed is corrected back to normal separately — see the long comment
// in buildFilterComplex. `chain` is the extra ffmpeg audio filter chain
// that gives the voice its character beyond raw pitch.
//
// Ranges were chosen by ear against intelligibility: past about 1.5 up or
// 0.72 down, consonants start dissolving and the prayer stops being
// followable, which defeats the point.
const VOICE_EFFECTS = {
  // Nasal and honking: scoop the chest register out, push the 1.5-2.5kHz
  // "quack" band hard, and wobble it.
  duck: {
    pitch: 1.42,
    chain:
      "equalizer=f=400:width_type=q:w=1.0:g=-5," +
      "equalizer=f=1900:width_type=q:w=1.1:g=6," +
      "vibrato=f=6.5:d=0.22",
  },
  // Small, fast and bright, with only a light wobble so it stays clear.
  chipmunk: {
    pitch: 1.34,
    chain: "equalizer=f=2600:width_type=q:w=1.0:g=3,vibrato=f=5:d=0.10",
  },
  // Bright and airy rather than squeaky — a lighter touch than chipmunk.
  sparkle: {
    pitch: 1.22,
    chain: "equalizer=f=3000:width_type=q:w=1.0:g=2.5,vibrato=f=4.5:d=0.08",
  },
  // Not-from-here: chorus detunes copies of the voice against itself and
  // tremolo pulses the level, which reads as "modulated" without touching
  // the words themselves.
  alien: {
    pitch: 1.16,
    chain:
      "chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|1.3,tremolo=f=6:d=0.35",
  },
  // Big and rumbling: lift the low end, take the presence band down.
  bear: {
    pitch: 0.78,
    chain:
      "equalizer=f=140:width_type=q:w=1.0:g=4," +
      "equalizer=f=2500:width_type=q:w=1.0:g=-2",
  },
  // Deadpan and dry — lowered a little, presence dulled, no movement at
  // all. The joke is that it refuses to be excited.
  grumpy: {
    pitch: 0.86,
    chain:
      "equalizer=f=180:width_type=q:w=1.0:g=3," +
      "equalizer=f=3000:width_type=q:w=1.2:g=-3",
  },
};

/**
 * Builds an ffmpeg filter_complex string that draws the title (for the
 * whole video) and each caption segment (only while it's active) over the
 * generated background, using textfile= so we never have to hand-escape
 * arbitrary prayer text for ffmpeg's filter syntax.
 */
function buildFilterComplex({
  theme,
  textStyle,
  accentColor,
  titlePath,
  titleLineCount = 1,
  openingBodyPath,
  captionFiles,
  wordFiles = [],
  hasBackgroundVideo = false,
  hasMusic = false,
  logoInputIndex = null,
  cartoonMode = false,
  pitchRatio = 1.0,
  voiceEffect = null,
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

  // Funny Cartoon category: no title, no prayer-text card, no captions —
  // just the character's portrait (already `currentLabel`, from the
  // hasBackgroundVideo scale/crop above) straight through to the watermark
  // below. The joke is the character + funny voice, not a text overlay.
  if (!cartoonMode) {
  // Title uses the user's chosen text-style font + accent color, for the
  // whole video (not just an opening card) — matches the thumbnail so the
  // video and its poster look like a matched set. Dark outline + drop
  // shadow guarantee it reads regardless of accent color or background
  // brightness (see TEXT_STYLES' titleBorderW comment above).
  filters.push(
    `[${currentLabel}]drawtext=textfile='${titlePath}':fontfile='${textStyle.font}':fontsize=${textStyle.videoFontSize}:fontcolor=${accentColor}:` +
      `bordercolor=black@0.55:borderw=${textStyle.titleBorderW}:shadowcolor=black@0.35:shadowx=2:shadowy=2:` +
      `x=(w-text_w)/2:y=140:line_spacing=10[${nextLabel}]`
  );
  currentLabel = nextLabel;

  // Prayer text card: scrim + the prayer text itself, visible for the whole
  // video (previously just the first few seconds — real usage showed the
  // text disappearing felt like it cut off partway through, so it now stays
  // up throughout). This also covers the original reason it was added: the
  // video's own native thumbnail/poster frame (generated by iMessage/
  // Photos/etc. from an early frame, entirely outside our control once the
  // file leaves the app) shows the full prayer text "at rest" instead of
  // just the bare background, matching what the in-app thumbnail looks
  // like — that's still true at t=0 since the card is always on now.
  if (openingBodyPath) {
    // Used to sit on a solid drawbox "card" (a big semi-transparent
    // rectangle) for contrast — that read as a gray/black bar smothering
    // half the photo. Replaced with the same treatment the title above
    // already uses: a dark/light outline + drop shadow burned directly onto
    // the letters, no background rectangle at all. The photo now shows
    // through fully behind the text, and the outline still guarantees
    // legibility regardless of how busy or bright the background is.
    //
    // bodyY still depends on the title's actual wrapped line count so a
    // long, multi-line title (e.g. "Bryan, Your Wonderful Day Awaits" in the
    // calligraphy font) doesn't run straight into the body text below it.
    const TITLE_TOP_Y = 140;
    const titleBlockHeight = titleLineCount * (textStyle.videoFontSize * 1.25 + 10);
    const cardTop = Math.max(460, Math.round(TITLE_TOP_Y + titleBlockHeight + 40));
    const bodyY = cardTop + 100;

    const bodyBorderColor = theme.text === "black" ? "white@0.85" : "black@0.6";
    nextLabel = "vcard2";
    filters.push(
      `[${currentLabel}]drawtext=textfile='${openingBodyPath}':fontfile='${FONT_SERIF}':fontsize=40:fontcolor=${theme.text}:` +
        `bordercolor=${bodyBorderColor}:borderw=2:shadowcolor=black@0.35:shadowx=2:shadowy=2:` +
        `line_spacing=20:x=(w-text_w)/2:y=${bodyY}[${nextLabel}]`
    );
    currentLabel = nextLabel;
  }

  } // end !cartoonMode — title and prayer-text card are suppressed above,
    // but the captions below are NOT: a cartoon video still needs the words
    // on screen, just along the bottom rather than as a card over the middle
    // of the character.

  // Prefer word-level highlighting (Sprint 3.6): one word on screen at a
  // time, in a gold highlight box, exactly timed to Whisper's per-word
  // timestamps — the caption tracks the speech instead of showing a whole
  // sentence at once. The box also guarantees contrast against real stock
  // footage backgrounds, which vary a lot in brightness. Older prayers
  // rendered before word_timings existed fall back to the plain per-segment
  // caption line.
  if (wordFiles.length > 0) {
    // Pinned to the same lower-screen band the plain-caption fallback below
    // uses (y=h-380), not screen-center. It used to be centered, which was
    // fine while the prayer-text card above was only ever on screen for a
    // brief opening window — now that the card stays up for the whole
    // video (see the block above), a vertically-centered highlight risked
    // landing right on top of the card's transcript text, especially for
    // longer prayers that wrap onto more lines.
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

  // Brand watermark: small, semi-transparent logo mark PLUS the actual
  // words "PrayerMessenger" (not just the icon — recipients who don't
  // recognize the mark on sight still see the app name spelled out) in the
  // bottom-right corner, composited on top of everything else (background +
  // title + captions) so it reads clearly regardless of what's behind it at
  // any given moment. Applied last, right before the vfinal rename below,
  // so it sits above the whole stack rather than getting drawn over.
  if (logoInputIndex != null) {
    filters.push(
      `[${logoInputIndex}:v]scale=120:-1,format=rgba,colorchannelmixer=aa=0.8[wm]`
    );
    nextLabel = "vwmlogo";
    filters.push(`[${currentLabel}][wm]overlay=W-w-36:H-h-56[${nextLabel}]`);
    currentLabel = nextLabel;
    nextLabel = "vwmtext";
    filters.push(
      `[${currentLabel}]drawtext=text='PrayerMessenger':fontfile='${FONT_BOLD}':fontsize=28:fontcolor=white@0.85:` +
        `bordercolor=black@0.5:borderw=2:x=w-text_w-36:y=h-196[${nextLabel}]`
    );
    currentLabel = nextLabel;
  }

  // Rename the last stage's output to the fixed label we map from.
  const lastFilterIndex = filters.length - 1;
  filters[lastFilterIndex] = filters[lastFilterIndex].replace(
    /\[[^[\]]+\]$/,
    "[vfinal]"
  );

  // FUNNY CARTOON VOICES.
  //
  // Two things make a voice sound like a character: where its pitch sits,
  // and how that pitch MOVES. Both are done here, on the TTS audio, and
  // only in cartoonMode — a real recorded prayer is never processed this
  // way.
  //
  // The pitch shift is ffmpeg's asetrate trick: resample the audio at a
  // different rate, then tell ffmpeg it is still 44100. That moves pitch
  // and speed together — play a tape faster and the voice goes up AND
  // gets quicker. The first version of this shipped exactly that, and the
  // speed-up is what made the prayers unfollowable.
  //
  // atempo is the correction. Running it at the reciprocal of the pitch
  // ratio puts the DURATION back exactly where it started while leaving
  // the pitch shifted. Measured: a 6.034s clip at ratios 1.45 / 1.25 /
  // 0.78 comes back 6.034s every time, with the fundamental landing on
  // 319.0 / 275.0 / 171.7 Hz against 220 Hz in — pitch moved, clock did
  // not. atempo's valid range is 0.5-2.0, which comfortably contains the
  // reciprocals of every ratio in VOICE_EFFECTS.
  //
  // The per-preset chain after it is the character: nasal EQ and a fast
  // vibrato make a duck, a low shelf makes a bear, chorus plus tremolo
  // makes something not-from-here. Deliberately kept short of the point
  // where words stop being words — this is a prayer, and a prayer you
  // cannot follow is broken however funny the voice.
  const effect =
    (cartoonMode && voiceEffect && VOICE_EFFECTS[voiceEffect]) || null;
  // No named preset: fall back to any legacy pitch_ratio on the row, but
  // run it through the same tempo compensation so an old value can never
  // reintroduce the speed-up.
  const effectivePitch = effect ? effect.pitch : pitchRatio;
  const effectChain = effect ? effect.chain : null;

  let voiceSource = "1:a";
  if (cartoonMode && (effectivePitch !== 1.0 || effectChain)) {
    const stages = [];
    if (effectivePitch !== 1.0) {
      stages.push(`asetrate=44100*${effectivePitch}`);
      stages.push("aresample=44100");
      stages.push(`atempo=${(1 / effectivePitch).toFixed(6)}`);
    }
    if (effectChain) stages.push(effectChain);
    filters.push(`[1:a]${stages.join(",")}[voice_char]`);
    voiceSource = "voice_char";
  }

  // EQ -> compression -> reverb, in that order (the standard vocal chain
  // order: the compressor should react to the already-EQ'd signal, and the
  // reverb should sit on top of the compressed result rather than being
  // squashed by it).
  //
  //   - highpass 80 Hz: these are phone recordings from all kinds of rooms.
  //     Below ~80 Hz there is nothing but handling rumble, desk thumps and
  //     AC hum, and leaving it in just makes the compressor pump against
  //     energy nobody can hear on a phone speaker anyway.
  //   - +2.5 dB @ 200 Hz (Q1.0): "body" — the chest-resonance region that
  //     makes a voice sound full rather than thin/tinny.
  //   - -2 dB @ 450 Hz (Q1.2): the "mud"/boxiness band. Cutting a little
  //     here is what actually makes the 200 Hz body boost read as warmth
  //     instead of congestion.
  //   - +3.5 dB @ 3.5 kHz (Q0.9): presence/consonant definition — this is
  //     the band that carries intelligibility, so it is the one that buys
  //     clarity against a music bed.
  //   - +2 dB shelf @ 8 kHz: a little air on top.
  const voiceEq =
    `highpass=f=80,` +
    `equalizer=f=200:width_type=q:w=1.0:g=2.5,` +
    `equalizer=f=450:width_type=q:w=1.2:g=-2,` +
    `equalizer=f=3500:width_type=q:w=0.9:g=3.5,` +
    `treble=f=8000:g=2`;

  // SERIAL COMPRESSION — two gentle stages rather than one hard one. A
  // single aggressive compressor audibly grabs at the voice; two stages
  // each doing part of the work sound smoother while removing MORE range
  // overall. Stage 1 is a slow leveller (high threshold, low ratio, slow
  // attack) that rides the overall performance; stage 2 is faster and
  // catches the peaks stage 1 deliberately let through.
  // Measured on a loud-then-quiet test signal: the gap between loud and
  // quiet passages goes 16.8 dB -> 12.2 dB versus the single-stage version,
  // with quiet passages landing ~3 dB louder.
  const voiceCompression =
    `acompressor=threshold=0.10:ratio=3:attack=20:release=250:knee=6:makeup=2,` +
    `acompressor=threshold=0.05:ratio=5:attack=8:release=180:knee=4:makeup=2.5`;

  // REVERB — two chained aecho stages, not one. A single aecho with three
  // taps is a slapback delay: you hear three discrete repeats, which is
  // what makes it sound metallic. Chaining two stages multiplies the taps
  // (4 x 4 = 16) into something dense enough to read as an actual room.
  // Stage 1 is early reflections (11-31 ms, the "size" cue), stage 2 turns
  // those into a decaying tail (53-131 ms). Decays are deliberately small
  // per tap — the density comes from the tap COUNT, not from loud repeats,
  // which is what keeps it clean instead of washy on a spoken voice.
  //
  // Deliberately NOT afir (true convolution reverb): it needs an impulse
  // response file shipped with the worker, and this pipeline already
  // discovered the hard way that reverb filters it assumed were present in
  // the Docker image's ffmpeg build (afreeverb) simply are not. aecho is
  // known-present here because it is already in use.
  //
  // out_gain MUST stay 1 on both stages — see the caution above.
  const voiceReverb =
    `aecho=in_gain=1:out_gain=1:delays=11|17|23|31:decays=0.12|0.09|0.07|0.05,` +
    `aecho=in_gain=1:out_gain=1:delays=53|71|97|131:decays=0.10|0.07|0.05|0.03`;

  filters.push(
    `[${voiceSource}]${voiceEq},${voiceCompression},${voiceReverb}[voice_proc]`
  );

  if (hasMusic) {
    filters.push(`[voice_proc]asplit=2[voice][voice_sc]`);
    // Base music level raised from 0.22 -> 0.5, and the sidechain duck eased
    // (ratio 10 -> 4, threshold 0.03 -> 0.06, release 400 -> 600) after users
    // reported the music being nearly inaudible under the voice. The old
    // settings meant the music sat at a whisper-quiet base level AND got
    // crushed almost to silence for the entire time anyone was speaking
    // (which, for a spoken prayer, is nearly the whole clip) — the two
    // effects compounded into "no audible music at all". Now the music sits
    // at a real, audible bed level and only dips moderately while the voice
    // is speaking, then comes back up between phrases, instead of getting
    // nearly muted for the whole track.
    filters.push(`[2:a]volume=0.5[music_pre]`);
    // Ratio raised 4 -> 8 (and threshold 0.06 -> 0.05) now that the library
    // includes tracks with their own singing in them. Two voices at once is
    // confusing, so while the prayer is being spoken the bed — singing and
    // all — has to get out of the way decisively, not politely.
    //
    // The base level above stays at 0.5 on purpose: the ORIGINAL "music is
    // inaudible" bug was a quiet base (0.22) AND a hard duck compounding, so
    // the bed was buried even in the gaps between phrases. Ducking hard from
    // a healthy base is a different thing — the music is plainly there when
    // nobody is talking and dips well under the voice when they are.
    // Release stays long-ish (500ms) so it recovers smoothly between phrases
    // instead of pumping up in every short gap.
    filters.push(
      `[music_pre][voice_sc]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=500:makeup=1[music]`
    );
    // normalize=0: amix defaults to auto-scaling every input down by 1/N,
    // which would quietly halve the voice track on top of the ducking
    // above — disable that so only the explicit levels above apply.
    // alimiter guards against clipping now that the voice is boosted well
    // above unity by the compressor's makeup gain.
    filters.push(
      `[voice][music]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.97[aout]`
    );
  } else {
    filters.push(`[voice_proc]alimiter=limit=0.97[aout]`);
  }

  return filters.join(";");
}

/**
 * Greedy word-wrap for drawtext (which never wraps on its own). Keeps each
 * line under maxCharsPerLine where possible; a single word longer than the
 * limit is left intact on its own line rather than being split mid-word.
 */
function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
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
  // Primary path: ask ffprobe for the container-level duration. This is
  // fast and works for the vast majority of files, but some MediaRecorder
  // outputs (notably iPhone Safari's audio/mp4 or raw ADTS AAC) can lack a
  // usable duration in the container metadata even though the audio itself
  // is fine.
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      audioPath,
    ]);
    const duration = parseFloat(stdout.trim());
    if (duration > 0) return duration;
  } catch {
    // fall through to the decode-based fallback below
  }

  // Fallback: same idea, but read the stream's own duration instead of the
  // container/format-level one — covers files where only the audio stream
  // carries a duration.
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-select_streams", "a:0",
      "-show_entries", "stream=duration",
      "-of", "csv=p=0",
      audioPath,
    ]);
    const duration = parseFloat(stdout.trim());
    if (duration > 0) return duration;
  } catch {
    // fall through to the full-decode fallback below
  }

  // Last resort: actually decode the whole file to silence and read how
  // much audio ffmpeg reports it processed (the last "time=" in its stats
  // output). Slower, but reliable even for streams with no duration
  // metadata at all (e.g. raw ADTS AAC) — this forces a full read of the
  // file rather than trusting header/container metadata.
  try {
    const { stdout, stderr } = await execFileAsync("ffmpeg", [
      "-v", "info",
      "-stats",
      "-i", audioPath,
      "-f", "null",
      "-",
    ]);
    const output = `${stdout || ""}${stderr || ""}`;
    const matches = [...output.matchAll(/time=(\d+):(\d+):(\d+\.?\d*)/g)];
    const last = matches[matches.length - 1];
    if (last) {
      const [, hours, minutes, seconds] = last;
      const duration = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
      if (duration > 0) return duration;
    }
  } catch {
    // Genuinely unreadable/corrupt audio — give up and let the caller
    // surface "Could not determine audio duration."
  }

  return null;
}

async function updateJob(id, fields) {
  const { error } = await supabase.from("render_jobs").update(fields).eq("id", id);
  if (error) {
    console.error(`Failed to update render_jobs ${id}:`, error.message);
  }
}

main();

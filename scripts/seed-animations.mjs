// Imports the hand-made animation clips: four of them become the animated
// visuals for existing cartoon characters, the rest join the background
// video style library.
//
//   node --env-file=.env.local scripts/seed-animations.mjs "/Users/myron/Desktop/new animation"
//   node --env-file=.env.local scripts/seed-animations.mjs "<folder>" --dry-run
//
// WHY EACH CLIP IS RE-ENCODED FIRST
//
// The source animations are LANDSCAPE (854x480, one at 1280x720) but every
// rendered prayer is 1080x1920 vertical. The worker's normal background
// handling is scale-to-fill + centre-crop, which on a 854x480 source means
// a 4x upscale AND throwing away ~68% of the frame width — enough to cut
// the subject clean out of shot.
//
// So each clip is pre-converted to 1080x1920 here, using ONE OF TWO
// treatments depending on what the clip is — see VERTICAL_LETTERBOX and
// VERTICAL_FILL below for the reasoning:
//
//   Background styles -> blurred letterbox (keeps the whole wide shot)
//   Character clips   -> fill the frame (keeps the character big)
//
// Either way the output is already 1080x1920, so the worker's own
// scale/crop step becomes a harmless no-op.
//
// Audio is stripped (the render pipeline never reads a background clip's
// audio) and the bitrate is capped, which also happens to shrink these by
// roughly 80%.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const BUCKET = "style-assets";
const DRY_RUN = process.argv.includes("--dry-run");
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Clips that animate an existing cartoon character (0015/0017). The still
// portrait stays as the picker thumbnail; this becomes what actually plays.
const CHARACTER_CLIPS = {
  "bear .mov": "Boomer the Bear",
  "Unicorn kids .mov": "Sparkle the Unicorn",
  "duck dance kids.mov": "Puddles the Duck",
  "chuckles kids happy.mov": "Chuckles the Squirrel",
};

// Everything else becomes a selectable background style. Categories match
// the ones the create page already groups by.
const STYLE_CLIPS = {
  "Angel of protection man .mov": ["Angel watching over a man", "Scripture"],
  "Angel protection women 2.mov": ["Angel watching over a woman", "Scripture"],
  "Angels protect family .mov": ["Angels watching over a family", "Family"],
  "angrel wings protection.mov": ["Angel wings of protection", "Scripture"],
  "babies happy dance.mov": ["Babies dancing", "Family"],
  "boat sale peace.mov": ["Sailboat on calm water", "Peaceful"],
  "cats dog church kids.mov": ["Pets and children at church", "Family"],
  "cross sunset.mov": ["Cross at sunset", "Scripture"],
  "galaxy stars .mov": ["Galaxy and stars", "Cinematic"],
  "garden peace relax.mov": ["Quiet garden", "Peaceful"],
  "Happy dance kids.mp4": ["Children dancing for joy", "Celebration"],
  "moon peace .mov": ["Moonlight stillness", "Peaceful"],
  "Rain clouds cartoon kids.mov": ["Children under the rain clouds", "Family"],
};

// Every source clip in the folder is 854x480 — 16:9 landscape — and the
// render is 1080x1920 vertical. There is no way to put a 16:9 frame into a
// 9:16 one without either shrinking it or cutting it, so both treatments
// below do the same two things: place a FITTED copy of the clip over a
// blurred, zoomed copy of itself, and trim some of the side margin first so
// the fitted copy lands bigger than a plain letterbox would.
//
// The trim is what the earlier passes got wrong in both directions. Plain
// letterbox left the subject at ~31% of the frame. Scale-to-fill went the
// other way and kept only the middle 31% of the WIDTH — measured on the
// actual clips, that cut the bear's ears off and sliced the squirrel's tail
// away, leaving an extreme close-up of a face. Trimming a fixed slice off
// each side and then fitting is the middle path: bigger subject, nothing
// lost.

// BACKGROUND STYLES — fill the frame completely.
//
// These were letterboxed at first: the scene fitted to the width with a
// blurred, zoomed copy of itself filling the space above and below. In a
// real render that looked broken rather than deliberate. The bands are a
// DIFFERENT part of the frame from the sharp scene, so a bright galaxy core
// smeared across the top sat over a dark starfield below with a hard seam
// between them — it read as a bug, not a border.
//
// Filling instead crops to the middle ~32% of the width, which sounds
// drastic and is the reason letterboxing was chosen originally. Checking it
// against the actual clips rather than assuming settled it: every one of
// these places its subject dead centre with margin to spare. An angel over
// a family, a cat at a pulpit, a baby dancing, a sunset, a sailboat, a rain
// cloud — all survive the crop whole, and fill the frame far better than
// they filled a band. Prayer text sits on the image with its outline and
// shadow, as it does over every Pexels clip in the library.
//
// This is NOT true of the character clips below, where the character spans
// most of the width; that is why the two treatments differ.
const VERTICAL_LETTERBOX =
  "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920," +
  "unsharp=5:5:0.6:5:5:0.0";

// CHARACTER CLIPS — a single centred character on a plain or softly
// gradient background. Measured subject extents across the four clips run
// from 30% to 88% of the width, so 10% off each side is the most that can
// come off without clipping the squirrel's tail; that is exactly what is
// trimmed here.
//
// Two details that matter:
//
//   - sigma=60 (vs 28 above). These backgrounds are near-flat, so blurring
//     that hard collapses the zoomed copy to essentially the clip's own
//     background colour. The bands stop reading as a smeared duplicate of
//     the character's face and start reading as the backdrop simply
//     continuing past the edges of the shot.
//   - the -150 vertical offset lifts the character above centre, which
//     clears the caption band at y=h-380. Cartoon videos carry captions
//     now, and a character sitting dead centre collides with them.
//
// unsharp recovers the edge definition lost to the ~2.5x upscale from 480p.
// That would wreck a photograph; these are flat cartoon renders with almost
// no fine detail to lose, so they take it well.
const VERTICAL_FILL =
  "split=2[bg][fg];" +
  "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920," +
  "gblur=sigma=60,eq=brightness=-0.03[bgb];" +
  "[fg]crop=trunc(iw*0.80/2)*2:ih:trunc(iw*0.10/2)*2:0,scale=1080:-2," +
  "unsharp=5:5:0.8:5:5:0.0[fgs];" +
  "[bgb][fgs]overlay=(W-w)/2:(H-h)/2-150";

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

async function encode(input, output, filter) {
  await execFileAsync("ffmpeg", [
    "-y", "-i", input,
    // Both treatments use split/overlay with labelled pads, which -vf
    // cannot express — it only takes a single linear chain.
    "-filter_complex", filter,
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "30",
    "-maxrate", "1400k",
    "-bufsize", "2800k",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    output,
  ]);
}

async function upload(storagePath, buffer) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: "video/mp4",
      upsert: true,
      cacheControl: "3600",
    });
  if (error) throw new Error(`upload: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error(
      'Usage: node --env-file=.env.local scripts/seed-animations.mjs "/path/to/folder"'
    );
    process.exit(1);
  }
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    console.error("ffmpeg not found on PATH. Install it first:\n\n  brew install ffmpeg\n");
    process.exit(1);
  }

  const { data: existingStyles } = await supabase.from("styles").select("name");
  const existingStyleNames = new Set((existingStyles || []).map((s) => s.name));

  const workDir = await mkdtemp(path.join(tmpdir(), "animations-"));
  let before = 0, after = 0, characters = 0, styles = 0;
  const failed = [];

  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}` +
      `Converting to 1080x1920, audio stripped.\n` +
      `  characters -> fill the frame   styles -> blurred letterbox\n`
  );

  try {
    for (const [file, characterName] of Object.entries(CHARACTER_CLIPS)) {
      const src = path.join(folder, file);
      const out = path.join(workDir, `${slug(characterName)}.mp4`);
      try {
        const srcSize = (await stat(src)).size;
        await encode(src, out, VERTICAL_FILL);
        const outSize = (await stat(out)).size;
        before += srcSize; after += outSize;

        console.log(
          `CHARACTER  ${characterName.padEnd(24)} ` +
            `${(srcSize / 1048576).toFixed(1)}MB -> ${(outSize / 1048576).toFixed(1)}MB`
        );

        if (!DRY_RUN) {
          const url = await upload(`characters/${slug(characterName)}-anim2.mp4`, await readFile(out));
          const { error } = await supabase
            .from("cartoon_characters")
            .update({ video_asset: url })
            .eq("name", characterName);
          if (error) throw new Error(`update: ${error.message}`);
          characters++;
        }
        await rm(out, { force: true });
      } catch (err) {
        console.error(`FAILED  ${file}: ${err.message}`);
        failed.push(file);
      }
    }

    for (const [file, [name, category]] of Object.entries(STYLE_CLIPS)) {
      const src = path.join(folder, file);
      const out = path.join(workDir, `${slug(name)}.mp4`);
      try {
        // Re-running this script is now how a reframed clip gets published,
        // so an existing style is UPDATED in place rather than skipped —
        // that keeps its id, and any prayer already pointing at it.
        const alreadyPresent = existingStyleNames.has(name);
        const srcSize = (await stat(src)).size;
        await encode(src, out, VERTICAL_LETTERBOX);
        const outSize = (await stat(out)).size;
        before += srcSize; after += outSize;

        console.log(
          `STYLE      ${name.padEnd(30).slice(0, 30)} ${category.padEnd(11)} ` +
            `${(srcSize / 1048576).toFixed(1)}MB -> ${(outSize / 1048576).toFixed(1)}MB`
        );

        if (!DRY_RUN) {
          const url = await upload(`videos/anim3-${slug(name)}.mp4`, await readFile(out));
          if (alreadyPresent) {
            const { error: updateError } = await supabase
              .from("styles")
              .update({ visual_asset: url })
              .eq("name", name);
            if (updateError) throw new Error(`update: ${updateError.message}`);
            styles++;
            await rm(out, { force: true });
            continue;
          }
          const { error } = await supabase.from("styles").insert({
            name,
            visual_asset: url,
            // Legacy NOT NULL column — music has been chosen independently
            // via music_style_id since 0010, and the worker only treats this
            // as a fallback when it starts with "http", so "" disables it.
            music_asset: "",
            category,
            source: "Original animation (PrayerMessenger)",
            license: null,
          });
          if (error) throw new Error(`insert: ${error.message}`);
          styles++;
        }
        await rm(out, { force: true });
      } catch (err) {
        console.error(`FAILED  ${file}: ${err.message}`);
        failed.push(file);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  console.log(`\n${"=".repeat(62)}`);
  console.log(
    DRY_RUN
      ? `Would animate ${Object.keys(CHARACTER_CLIPS).length} character(s) and add ${Object.keys(STYLE_CLIPS).length} style(s)`
      : `Animated ${characters} character(s), added ${styles} background style(s)`
  );
  console.log(
    `Size:  ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`
  );
  if (failed.length) console.log(`FAILED: ${failed.join(", ")}`);
  console.log("=".repeat(62));
  if (DRY_RUN) console.log("\nLooks right? Re-run without --dry-run to import for real.");
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

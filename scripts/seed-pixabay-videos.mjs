// Pixabay video seeder — flowers, roses, waterfalls and other scenery, added
// to the same `styles` table the Pexels seeder fills.
//
// WHY A SECOND LIBRARY. Pexels and Pixabay index different contributors, so
// the same query returns largely different clips. Asking one library for
// "roses" ten times returns its ten best roses; asking two returns twenty.
//
// LICENCE. Pixabay's licence allows commercial use with no attribution and
// explicitly permits incorporating content into apps and services, which is
// exactly this. What it does not allow is redistributing the files as they
// came — so these are only ever composited behind a prayer, never offered
// as downloadable stock. Rows record source and licence, and /credits shows
// them; Pixabay asks that users be told where content came from, and that
// page is how.
//
// RATE LIMITS. Pixabay allows 100 requests/minute and asks that callers not
// mass-download. This pauses between searches and defaults to a modest
// --limit; it is meant to be run in small bursts as the library grows, not
// pointed at the whole catalogue.
//
// Run from the repo root, ON A MACHINE WITH NORMAL INTERNET (this sandbox's
// egress blocks Pixabay, same as Pexels):
//
//   node --env-file=.env.local scripts/seed-pixabay-videos.mjs --limit=20
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
// and PIXABAY_API_KEY. The key is free: sign in at pixabay.com and it is
// shown on https://pixabay.com/api/docs/ — add it to .env.local as
//
//   PIXABAY_API_KEY=...
//
// Flags:
//   --limit=N       stop after N new clips total (default 20)
//   --dry-run       search and report, download and write nothing
//   --seconds=N     clip length to keep (default 12)

import { createClient } from "@supabase/supabase-js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ensureFfmpeg,
  encodeForRender,
  download,
  uploadToBucket,
  MB,
  TARGET_SECONDS,
} from "./lib/ingest.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;
const BUCKET = "style-assets";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!PIXABAY_API_KEY) {
  console.error(
    "Missing PIXABAY_API_KEY.\n\n" +
      "It is free: sign in at pixabay.com, then copy the key shown on\n" +
      "https://pixabay.com/api/docs/ into .env.local as PIXABAY_API_KEY=...\n"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
const DRY_RUN = process.argv.includes("--dry-run");
const GLOBAL_LIMIT = flag("limit", 20);
const SECONDS = flag("seconds", TARGET_SECONDS);

// Categories match the ones already in `styles` so these land in the
// existing picker, plus Flowers, which is new — a rose is not "Nature" to
// anyone looking for a rose.
const CATEGORIES = {
  Flowers: [
    "roses", "rose petals", "flower field", "blooming flowers",
    "cherry blossom", "sunflower field", "lavender field", "tulips",
    "wildflowers meadow", "orchid",
  ],
  Nature: [
    "waterfall", "tropical waterfall", "forest waterfall", "mountain stream",
    "autumn leaves", "sunlight through trees", "dew on grass",
  ],
  Peaceful: [
    "calm lake sunrise", "misty forest", "gentle river", "sunset over water",
    "clouds time lapse",
  ],
  Cinematic: [
    "aerial coastline", "northern lights", "starry sky time lapse",
    "golden hour field",
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchPixabay(query) {
  const url =
    `https://pixabay.com/api/videos/?key=${PIXABAY_API_KEY}` +
    `&q=${encodeURIComponent(query)}&per_page=12&safesearch=true&order=popular`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search "${query}" failed: ${res.status}`);
  return (await res.json()).hits || [];
}

// Prefer the smallest rendition that still has 1920 pixels on its long edge.
// The encode crops to 1080x1920 regardless, so downloading Pixabay's 4K
// master only means paying to throw away pixels.
function pickFile(hit) {
  const order = ["medium", "small", "large", "tiny"];
  const usable = order
    .map((k) => hit.videos?.[k])
    .filter((f) => f?.url && Math.max(f.width || 0, f.height || 0) >= 1080);
  return usable[0] ?? hit.videos?.large ?? hit.videos?.medium ?? null;
}

async function main() {
  if (!DRY_RUN) await ensureFfmpeg();
  const workDir = await mkdtemp(path.join(tmpdir(), "pixabay-"));

  // Re-runs must not duplicate. The Pixabay id is embedded in the stored
  // filename, which is the same trick the Pexels seeder uses.
  const { data: existingRows } = await supabase.from("styles").select("visual_asset");
  const existing = new Set(
    (existingRows || [])
      .map((r) => (r.visual_asset || "").match(/pixabay-(\d+)\.mp4$/)?.[1])
      .filter(Boolean)
  );
  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}` +
      `${existing.size} Pixabay clip(s) already imported. ` +
      `Limit ${GLOBAL_LIMIT}, encoding to 1080x1920 / ${SECONDS}s / no audio.\n`
  );

  let imported = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  const failed = [];

  outer: for (const [category, queries] of Object.entries(CATEGORIES)) {
    console.log(`\n=== ${category} ===`);
    for (const query of queries) {
      if (imported >= GLOBAL_LIMIT) break outer;
      let hits;
      try {
        hits = await searchPixabay(query);
      } catch (err) {
        console.error(`  ${err.message}`);
        continue;
      }
      await sleep(700); // stay well inside 100 req/min

      for (const hit of hits) {
        if (imported >= GLOBAL_LIMIT) break outer;
        const id = String(hit.id);
        if (existing.has(id)) continue;
        const file = pickFile(hit);
        if (!file) continue;
        existing.add(id);

        const name = `${category} — ${query}`;
        if (DRY_RUN) {
          console.log(`  would import pixabay-${id}  ${name}`);
          imported++;
          continue;
        }
        try {
          const raw = path.join(workDir, `${id}-raw.mp4`);
          const out = path.join(workDir, `pixabay-${id}.mp4`);
          const rawBytes = await download(file.url, raw);
          const outBytes = await encodeForRender(raw, out, { seconds: SECONDS });
          bytesBefore += rawBytes;
          bytesAfter += outBytes;

          const url = await uploadToBucket(
            supabase, BUCKET, out, `videos/pixabay-${id}.mp4`
          );
          const { error } = await supabase.from("styles").insert({
            name,
            visual_asset: url,
            music_asset: null,
            category,
            source: `Pixabay (${hit.pageURL || `id ${id}`})`,
            license: "Pixabay Content License — free for commercial use, no attribution required",
          });
          if (error) throw new Error(error.message);

          imported++;
          console.log(
            `  ${String(imported).padStart(2)}. ${name.padEnd(34).slice(0, 34)} ` +
              `${MB(rawBytes)} -> ${MB(outBytes)}`
          );
        } catch (err) {
          console.error(`  FAILED pixabay-${id}: ${err.message}`);
          failed.push(id);
        }
      }
    }
  }

  await rm(workDir, { recursive: true, force: true });
  console.log(`\nImported ${imported} clip(s).`);
  if (bytesBefore) {
    console.log(
      `Downloaded ${MB(bytesBefore)}, stored ${MB(bytesAfter)} ` +
        `(${(100 - (bytesAfter / bytesBefore) * 100).toFixed(0)}% smaller).`
    );
  }
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

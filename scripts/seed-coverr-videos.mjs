// Coverr video seeder — the first source tried, per the agreed order:
//
//   1. Coverr   2. Mixkit (manual)   3. Pexels   4. Pixabay
//
// LICENCE. Coverr allows commercial use with no attribution. Two limits
// matter and both are respected here: the files may not be redistributed,
// and you may not build a service that COMPETES WITH COVERR — a stock
// library, a website builder, a video editor that hands its users the raw
// clips. PrayerMessenger does none of that; a clip only ever appears
// composited behind someone's prayer, never offered as footage. Coverr also
// forbids using its videos as AI training data, which nothing here does.
//
// RATE LIMIT. A new API key is "demo" status: 50 requests per hour. One
// search per term, 38 terms, so a full pass fits — but only just, which is
// why this pauses between searches and stops at --limit rather than
// paginating. Run it in bursts.
//
// Run from the repo root, ON A MACHINE WITH NORMAL INTERNET (this sandbox's
// egress blocks Coverr, same as the others):
//
//   node --env-file=.env.local scripts/seed-coverr-videos.mjs --dry-run
//   node --env-file=.env.local scripts/seed-coverr-videos.mjs --limit=20
//
// Requires COVERR_API_KEY in .env.local. Free: sign in at coverr.co, create
// an application under coverr.co/developers, and the key is issued
// instantly.

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
import { queryPairs } from "./lib/queries.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COVERR_API_KEY = process.env.COVERR_API_KEY;
const BUCKET = "style-assets";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!COVERR_API_KEY) {
  console.error(
    "Missing COVERR_API_KEY.\n\n" +
      "Free: sign in at coverr.co, create an application at coverr.co/developers,\n" +
      "then add it to .env.local as COVERR_API_KEY=...\n"
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
const PER_QUERY = flag("per-query", 3);
const SECONDS = flag("seconds", TARGET_SECONDS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchCoverr(query) {
  const url =
    `https://api.coverr.co/videos?query=${encodeURIComponent(query)}` +
    `&page_size=12&urls=true&sort=popular&api_key=${COVERR_API_KEY}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${COVERR_API_KEY}` },
  });
  if (res.status === 429) throw new Error("rate limited (demo keys allow 50/hour) — wait and re-run");
  if (!res.ok) throw new Error(`search "${query}" failed: ${res.status}`);
  const data = await res.json();
  return data.hits || [];
}

// mp4_download carries a Content-Disposition header; mp4 is the plain file.
// Either is fine to encode from, so take whichever the response actually has.
const fileUrl = (hit) => hit.urls?.mp4_download || hit.urls?.mp4 || hit.urls?.mp4_preview || null;

async function main() {
  if (!DRY_RUN) await ensureFfmpeg();
  const workDir = await mkdtemp(path.join(tmpdir(), "coverr-"));

  const { data: existingRows } = await supabase.from("styles").select("visual_asset");
  const existing = new Set(
    (existingRows || [])
      .map((r) => (r.visual_asset || "").match(/coverr-([A-Za-z0-9_-]+)\.mp4$/)?.[1])
      .filter(Boolean)
  );

  const pairs = queryPairs();
  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}` +
      `${existing.size} Coverr clip(s) already imported. ` +
      `${pairs.length} queries, limit ${GLOBAL_LIMIT}, ` +
      `encoding to 1080x1920 / ${SECONDS}s / no audio.\n`
  );

  let imported = 0, before = 0, after = 0;
  const failed = [];

  for (const [category, query] of pairs) {
    if (imported >= GLOBAL_LIMIT) break;
    let hits;
    try {
      hits = await searchCoverr(query);
    } catch (err) {
      console.error(`  ${err.message}`);
      if (String(err.message).includes("rate limited")) break;
      continue;
    }
    await sleep(1200);

    let takenHere = 0;
    for (const hit of hits) {
      if (imported >= GLOBAL_LIMIT || takenHere >= PER_QUERY) break;
      const id = String(hit.id);
      if (existing.has(id)) continue;
      const src = fileUrl(hit);
      if (!src) continue;
      existing.add(id);

      const name = `${category} — ${query}`;
      if (DRY_RUN) {
        console.log(`  would import coverr-${id.padEnd(12)} ${name}`);
        imported++; takenHere++;
        continue;
      }
      try {
        const raw = path.join(workDir, `${id}-raw.mp4`);
        const out = path.join(workDir, `coverr-${id}.mp4`);
        const rawBytes = await download(src, raw);
        const outBytes = await encodeForRender(raw, out, { seconds: SECONDS });
        before += rawBytes; after += outBytes;

        const url = await uploadToBucket(supabase, BUCKET, out, `videos/coverr-${id}.mp4`);
        const { error } = await supabase.from("styles").insert({
          name,
          visual_asset: url,
          music_asset: null,
          category,
          source: `Coverr (${hit.title || id})`,
          license: "Coverr License — free for commercial use, no attribution required",
        });
        if (error) throw new Error(error.message);

        imported++; takenHere++;
        console.log(
          `  ${String(imported).padStart(2)}. ${name.padEnd(34).slice(0, 34)} ` +
            `${MB(rawBytes)} -> ${MB(outBytes)}`
        );
      } catch (err) {
        console.error(`  FAILED coverr-${id}: ${err.message}`);
        failed.push(id);
      }
    }
  }

  await rm(workDir, { recursive: true, force: true });
  console.log(`\nImported ${imported} clip(s).`);
  if (before) {
    console.log(
      `Downloaded ${MB(before)}, stored ${MB(after)} ` +
        `(${(100 - (after / before) * 100).toFixed(0)}% smaller).`
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

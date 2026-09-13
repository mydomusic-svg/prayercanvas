// Reports exactly what is using Supabase Storage, bucket by bucket, and
// flags what is safe to delete.
//
// WHY: the project is over its free-tier storage quota and gets restricted
// on 17 September. "Delete some stuff" is not a plan — the last round of
// guessing had us convinced videos were the problem when it was actually
// the music library (286MB across 77 tracks, one of them 32MB, against
// 292MB for all 242 video clips combined). Measure first, then cut.
//
//   node --env-file=.env.local scripts/audit-storage.mjs
//   node --env-file=.env.local scripts/audit-storage.mjs --delete-orphans
//
// Without --delete-orphans it changes nothing. Read the report first.
//
// An "orphan" here is a file under prayer-videos/<user>/<prayer>/ whose
// prayer row no longer exists. Those can never be reached by anyone: the
// only route to a rendered video is through its prayer. Deleting them is
// the one cut that costs nothing at all, so it is the one this script will
// make for you. Everything else it only reports, because "is this still
// needed" is a judgement about the product, not about the data.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local scripts/audit-storage.mjs");
  process.exit(1);
}

const DELETE_ORPHANS = process.argv.includes("--delete-orphans");
const supabase = createClient(url, key);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

// Storage list() is per-prefix and caps out, so walk the tree rather than
// asking for everything and quietly getting a truncated answer — which
// would understate the total and send us cutting the wrong thing again.
async function walk(bucket, prefix = "", depth = 0) {
  if (depth > 4) return [];
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 100, offset });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder comes back with no id and no metadata.
      if (entry.id === null || !entry.metadata) {
        out.push(...(await walk(bucket, path, depth + 1)));
      } else {
        out.push({ path, size: entry.metadata.size ?? 0 });
      }
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return out;
}

async function main() {
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) throw new Error(`could not list buckets: ${bucketError.message}`);

  console.log("SUPABASE STORAGE AUDIT\n");

  let grandTotal = 0;
  const byBucket = [];

  for (const bucket of buckets) {
    let files;
    try {
      files = await walk(bucket.name);
    } catch (err) {
      console.log(`  ${bucket.name}: FAILED (${err.message})`);
      continue;
    }
    const total = files.reduce((n, f) => n + f.size, 0);
    grandTotal += total;
    byBucket.push({ name: bucket.name, files, total });
  }

  byBucket.sort((a, b) => b.total - a.total);

  console.log("Bucket                     Files      Size");
  console.log("-".repeat(46));
  for (const b of byBucket) {
    console.log(
      `${b.name.padEnd(26)}${String(b.files.length).padStart(5)}  ${(mb(b.total) + " MB").padStart(10)}`
    );
  }
  console.log("-".repeat(46));
  console.log(`${"TOTAL".padEnd(26)}${String(byBucket.reduce((n, b) => n + b.files.length, 0)).padStart(5)}  ${(mb(grandTotal) + " MB").padStart(10)}`);
  console.log(`\nFree tier is 1024 MB. You are at ${mb(grandTotal)} MB (${((grandTotal / 1024 / 1024 / 1024) * 100).toFixed(0)}% of it).\n`);

  // Ten biggest files anywhere — this is how the 32MB music track was found.
  const all = byBucket.flatMap((b) => b.files.map((f) => ({ ...f, bucket: b.name })));
  all.sort((a, b) => b.size - a.size);
  console.log("Ten largest files:");
  for (const f of all.slice(0, 10)) {
    console.log(`  ${(mb(f.size) + " MB").padStart(9)}  ${f.bucket}/${f.path}`);
  }

  // Orphaned rendered videos.
  const videos = byBucket.find((b) => b.name === "prayer-videos");
  if (videos) {
    const prayerIds = new Set();
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("prayers")
        .select("id")
        .range(from, from + 999);
      if (error) throw new Error(`could not read prayers: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const p of data) prayerIds.add(p.id);
      if (data.length < 1000) break;
      from += 1000;
    }

    const orphans = videos.files.filter((f) => {
      const parts = f.path.split("/");
      if (parts.length < 3) return false; // not <user>/<prayer>/<file>
      return !prayerIds.has(parts[1]);
    });
    const orphanBytes = orphans.reduce((n, f) => n + f.size, 0);

    console.log(
      `\nOrphaned video files (prayer row gone): ${orphans.length} files, ${mb(orphanBytes)} MB`
    );

    if (orphans.length && DELETE_ORPHANS) {
      for (let i = 0; i < orphans.length; i += 100) {
        const batch = orphans.slice(i, i + 100).map((f) => f.path);
        const { error } = await supabase.storage.from("prayer-videos").remove(batch);
        if (error) throw new Error(`delete failed: ${error.message}`);
        console.log(`  deleted ${batch.length}`);
      }
      console.log(`Reclaimed ${mb(orphanBytes)} MB. New total: ${mb(grandTotal - orphanBytes)} MB.`);
    } else if (orphans.length) {
      console.log("  Re-run with --delete-orphans to remove them.");
    }
  }

  console.log(
    "\nNOTE: Storage is only one of Supabase's quota metrics, and the " +
      "restriction notice is based on the PREVIOUS cycle's average, not " +
      "today's number. Getting under 1024 MB now does not automatically " +
      "clear a notice earned last cycle — check the usage page."
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

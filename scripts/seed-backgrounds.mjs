// Runs the background-video seeders in the agreed order of preference:
//
//   1. Coverr    (API — needs COVERR_API_KEY)
//   2. Mixkit    (no public API — manual download, see below)
//   3. Pexels    (API — needs PEXELS_API_KEY)
//   4. Pixabay   (API — needs PIXABAY_API_KEY)
//
// Order is preference, not just sequence: each source is asked for clips
// until the total --limit is reached, so Coverr fills the library first and
// the later ones only supply what is still missing. A source whose key is
// absent is SKIPPED with a note rather than treated as a failure — three
// working sources out of four is a good run, not a broken one.
//
// Mixkit cannot be automated: it has no public API and scraping it would
// breach its terms. This prints the exact import command to run after
// downloading clips by hand, at the point in the order where Mixkit sits.
//
//   node --env-file=.env.local scripts/seed-backgrounds.mjs --limit=40
//   node --env-file=.env.local scripts/seed-backgrounds.mjs --dry-run

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const TOTAL_LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 40;

const SOURCES = [
  { name: "Coverr", script: "seed-coverr-videos.mjs", key: "COVERR_API_KEY",
    how: "sign in at coverr.co, create an app at coverr.co/developers" },
  { name: "Pexels", script: "seed-video-library.mjs", key: "PEXELS_API_KEY",
    how: "pexels.com/api" },
  { name: "Pixabay", script: "seed-pixabay-videos.mjs", key: "PIXABAY_API_KEY",
    how: "sign in at pixabay.com, key is shown on pixabay.com/api/docs" },
];

// Roughly even split, with whatever a skipped source would have taken
// rolling forward to the next one.
const share = Math.max(1, Math.ceil(TOTAL_LIMIT / SOURCES.length));

function run(script, args) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join(HERE, script), ...args],
      { stdio: "inherit", env: process.env }
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function printMixkitStep() {
  console.log(
    `\n--- Mixkit — manual, no public API.\n` +
      `    Download clips from mixkit.co/free-stock-video, then:\n\n` +
      `      node --env-file=.env.local scripts/import-local-videos.mjs \\\n` +
      `        --folder="~/Downloads/mixkit" --source="Mixkit" \\\n` +
      `        --license="Mixkit Free License — free for commercial use, no attribution required"\n`
  );
}

async function main() {
  console.log(
    `Seeding backgrounds — Coverr, then Mixkit (manual), then Pexels, then Pixabay.\n` +
      `Target ${TOTAL_LIMIT} new clip(s) total.${DRY_RUN ? "  DRY RUN." : ""}\n`
  );

  let budget = TOTAL_LIMIT;
  const skipped = [];

  for (const source of SOURCES) {
    if (budget <= 0) break;
    if (!process.env[source.key]) {
      skipped.push(source);
      console.log(`\n--- ${source.name}: skipped, ${source.key} not set (${source.how})`);
      // Mixkit sits after Coverr in the order and is manual either way, so
      // its note must still print when Coverr itself was skipped —
      // otherwise a missing Coverr key silently drops step 2 as well.
      if (source.name === "Coverr") printMixkitStep();
      continue;
    }
    const take = Math.min(budget, share);
    console.log(`\n=== ${source.name} — up to ${take} clip(s) ===`);
    const args = [`--limit=${take}`, ...(DRY_RUN ? ["--dry-run"] : [])];
    const code = await run(source.script, args);
    if (code !== 0) console.log(`  (${source.name} exited ${code} — continuing)`);
    budget -= take;

    if (source.name === "Coverr") printMixkitStep();
  }

  if (skipped.length) {
    console.log(`\nSkipped for want of a key: ${skipped.map((s) => s.name).join(", ")}.`);
  }
  console.log("\nDone. Re-run any time — every seeder skips ids it already imported.");
}

main().catch((err) => {
  console.error("Run failed:", err);
  process.exit(1);
});

// Who has signed up, and did the share loop bring any of them?
//
// The /admin/stats page answers this in a browser, but only while you are
// signed in to the app. This reads the same numbers straight from the
// database, so it works from a terminal with no login and no browser.
//
//   node --env-file=.env.local scripts/who-signed-up.mjs
//   node --env-file=.env.local scripts/who-signed-up.mjs --since 2026-09-13
//
// Reads only. Writes nothing, changes nothing.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local scripts/who-signed-up.mjs");
  process.exit(1);
}

// --links prints the live share URLs, so the page a stranger actually
// meets can be opened and judged rather than imagined.
const LINKS = process.argv.includes("--links");

const i = process.argv.indexOf("--since");
const SINCE = i !== -1 ? process.argv[i + 1] : null;

const supabase = createClient(url, key);
const when = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

async function main() {
  const { data: users, error } = await supabase
    .from("users")
    .select("email, display_name, plan, referred_by_share_token, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not read users: ${error.message}`);

  const recent = SINCE
    ? users.filter((u) => new Date(u.created_at) >= new Date(SINCE))
    : users;

  console.log(`\nACCOUNTS — ${users.length} total` + (SINCE ? `, ${recent.length} since ${SINCE}` : "") + "\n");
  for (const u of users) {
    const isNew = SINCE && new Date(u.created_at) >= new Date(SINCE);
    // The whole question of the share loop: did this person arrive through
    // a prayer somebody sent them, or did they find their own way here?
    const via = u.referred_by_share_token ? "via share link" : "direct";
    console.log(
      `  ${isNew ? "NEW " : "    "}${when(u.created_at)}  ${(u.email ?? "-").padEnd(32)}` +
        `${(u.plan ?? "free").padEnd(7)}${via}`
    );
  }

  const counts = async (table, build) => {
    let q = supabase.from(table).select("*", { count: "exact", head: true });
    if (build) q = build(q);
    const { count, error: e } = await q;
    if (e) throw new Error(`${table}: ${e.message}`);
    return count ?? 0;
  };

  const prayers = await counts("prayers");
  const prayersRecent = SINCE ? await counts("prayers", (q) => q.gte("created_at", SINCE)) : null;
  const failed = await counts("render_jobs", (q) => q.eq("status", "failed"));

  const { data: links } = await supabase.from("share_links").select("view_count");
  const shares = links?.length ?? 0;
  const views = (links ?? []).reduce((n, r) => n + (r.view_count ?? 0), 0);
  const referred = users.filter((u) => u.referred_by_share_token).length;

  console.log(`
ACTIVITY
  Prayers made          ${prayers}${prayersRecent !== null ? `  (${prayersRecent} since ${SINCE})` : ""}
  Prayers shared        ${shares}
  Share links opened    ${views}
  Renders failed        ${failed}

THE SHARE LOOP
  ${referred} of ${views} people who opened a shared prayer went on to sign up.`);

  if (LINKS) {
    const { data: rows } = await supabase
      .from("share_links")
      .select("token, view_count, created_at")
      .order("view_count", { ascending: false })
      .limit(10);
    console.log("\nSHARE LINKS (most opened first)");
    for (const r of rows ?? []) {
      console.log(`  ${String(r.view_count).padStart(4)} opens   https://prayermessenger.com/p/${r.token}`);
    }
  }

  if (views < 50) {
    console.log(`  Too few views to read yet — one signup moves this by ${(100 / Math.max(views, 1)).toFixed(0)} points.`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Stats · PrayerMessenger" };
// Always live. A cached growth number is worse than no growth number,
// because it looks current.
export const dynamic = "force-dynamic";

/**
 * The share loop, in numbers.
 *
 * There is exactly one question this page exists to answer: of the people
 * who open a shared prayer, how many make one of their own? That ratio
 * decides whether this app grows by itself or has to be pushed uphill
 * forever, and it was previously unknowable — view_count told us how many
 * people looked, and nothing told us how many stayed.
 *
 * Admin-only, and 404 rather than 403 for a non-admin: a page that says
 * "forbidden" confirms it exists.
 */
export default async function StatsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("users")
    .select("plan")
    .eq("id", user.id)
    .single();
  if (me?.plan !== "admin") notFound();

  // Counts span every user's rows, which RLS correctly hides from an
  // ordinary client. This is the one place that legitimately needs to see
  // across accounts, and it is gated on the admin check above.
  const admin = createAdminClient();
  const since = new Date(Date.now() - 7 * 864e5).toISOString();

  // Counted with head:true — Postgres returns the count and no rows, so
  // these stay cheap however large the tables get.
  const head = { count: "exact" as const, head: true };

  const [
    users,
    referredUsers,
    prayers,
    prayersThisWeek,
    shareLinks,
    rendersDone,
    rendersFailed,
  ] = await Promise.all([
    admin.from("users").select("*", head),
    admin.from("users").select("*", head).not("referred_by_share_token", "is", null),
    admin.from("prayers").select("*", head),
    admin.from("prayers").select("*", head).gte("created_at", since),
    admin.from("share_links").select("*", head),
    admin.from("render_jobs").select("*", head).eq("status", "complete"),
    admin.from("render_jobs").select("*", head).eq("status", "failed"),
  ]).then((results) => results.map((r) => r.count ?? 0));

  const { data: linkRows } = await admin.from("share_links").select("view_count");
  const shareViews = (linkRows ?? []).reduce(
    (n, r) => n + ((r.view_count as number) ?? 0),
    0
  );

  // The headline. Deliberately shown as "of N views" rather than as a bare
  // percentage: at these volumes one extra signup moves the rate by tens of
  // points, and a percentage with no denominator invites reading noise as a
  // trend.
  const loopRate = shareViews > 0 ? (referredUsers / shareViews) * 100 : null;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-serif text-3xl text-sage-900">Stats</h1>

      <section className="mt-8 rounded-2xl border border-sage-200 bg-white p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-sage-500">
          Does the share loop work?
        </h2>
        <p className="mt-3 text-4xl font-semibold text-sage-900">
          {loopRate === null ? "—" : `${loopRate.toFixed(1)}%`}
        </p>
        <p className="mt-2 text-sm text-sage-600">
          {referredUsers} of {shareViews} people who opened a shared prayer
          went on to create an account.
        </p>
        {shareViews < 50 && (
          <p className="mt-3 text-xs text-sage-400">
            Too few views to mean anything yet — one signup moves this by
            several points. Worth reading at around 50 views.
          </p>
        )}
      </section>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Stat label="Accounts" value={users} />
        <Stat label="Prayers, all time" value={prayers} />
        <Stat label="Prayers, last 7 days" value={prayersThisWeek} />
        <Stat label="Prayers shared" value={shareLinks} />
        <Stat label="Share views" value={shareViews} />
        <Stat label="Renders completed" value={rendersDone} />
        <Stat
          label="Renders failed"
          value={rendersFailed}
          tone={rendersFailed > 0 ? "warn" : undefined}
        />
        <Stat
          label="Shared, of all prayers"
          value={prayers > 0 ? `${((shareLinks / prayers) * 100).toFixed(0)}%` : "—"}
        />
      </div>

      <p className="mt-8 text-xs leading-relaxed text-sage-400">
        Attribution is coarse on purpose. It cannot tell which prayer
        persuaded someone who opened several, and it misses anyone who opens
        a link on their phone and signs up on a laptop. The question is
        whether the loop converts at all, not precisely who to credit.
      </p>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border border-sage-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-sage-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          tone === "warn" ? "text-amber-700" : "text-sage-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

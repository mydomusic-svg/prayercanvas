import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PrayerActions from "../prayer-actions";
import type { RenderJob } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: prayers } = await supabase
    .from("prayers")
    .select("id, recipient_name, occasion, title, theme, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const prayerIds = (prayers ?? []).map((p) => p.id);

  // One latest-per-prayer render job, derived in JS rather than a second
  // round-trip per card — Supabase's query builder doesn't have a clean
  // "latest row per group" without a view/RPC, and this list is small
  // enough (a user's own prayers) that it's not worth adding one yet.
  const latestJobByPrayer = new Map<string, RenderJob>();
  if (prayerIds.length > 0) {
    const { data: jobs } = await supabase
      .from("render_jobs")
      .select("*")
      .in("prayer_id", prayerIds)
      .order("created_at", { ascending: false });

    for (const job of (jobs as RenderJob[] | null) ?? []) {
      if (!latestJobByPrayer.has(job.prayer_id)) {
        latestJobByPrayer.set(job.prayer_id, job);
      }
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Prayers</h1>
        <Link
          href="/create"
          className="rounded-full bg-neutral-900 px-5 py-2 text-sm text-white transition hover:bg-neutral-700"
        >
          + New Prayer
        </Link>
      </div>

      {!prayers || prayers.length === 0 ? (
        <p className="text-neutral-500">
          You haven&apos;t created a prayer yet.{" "}
          <Link href="/create" className="underline">
            Create your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
          {prayers.map((prayer) => {
            const job = latestJobByPrayer.get(prayer.id);
            const displayTitle =
              prayer.title ||
              (prayer.recipient_name
                ? `A Prayer for ${prayer.recipient_name}`
                : "Untitled Prayer");

            return (
              <li
                key={prayer.id}
                className="flex flex-col overflow-hidden rounded-xl border border-neutral-200"
              >
                <Link
                  href={`/prayers/${prayer.id}`}
                  className="relative block aspect-[9/16] w-full bg-neutral-100"
                >
                  {job?.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={job.thumbnail_url}
                      alt={displayTitle}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-neutral-400">
                      {job?.status === "failed"
                        ? "Render failed"
                        : job
                          ? "Rendering…"
                          : "No render yet"}
                    </div>
                  )}
                  {job?.status === "complete" && (
                    <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                      ▶ Play
                    </span>
                  )}
                </Link>

                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/prayers/${prayer.id}`}
                      className="line-clamp-2 font-medium hover:underline"
                    >
                      {displayTitle}
                    </Link>
                    {prayer.theme && (
                      <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs capitalize text-neutral-600">
                        {prayer.theme}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-400">
                    {new Date(prayer.created_at).toLocaleDateString()}
                  </p>

                  <div className="mt-1">
                    <PrayerActions
                      prayerId={prayer.id}
                      userId={user.id}
                      videoUrl={
                        job?.status === "complete" ? (job.output_url ?? null) : null
                      }
                      title={displayTitle}
                      compact
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

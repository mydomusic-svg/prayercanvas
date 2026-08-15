import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PrayerGrid from "./prayer-grid";
import HeroBanner from "../hero-banner";
import type { RenderJob } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: prayers } = await supabase
    .from("prayers")
    .select("id, recipient_name, include_recipient_in_title, occasion, title, theme, created_at")
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

  const jobs: Record<string, RenderJob | undefined> = {};
  for (const [prayerId, job] of latestJobByPrayer) {
    jobs[prayerId] = job;
  }

  return (
    <>
      <HeroBanner variant="slim" />
      <main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 px-6 py-16">
        <PrayerGrid prayers={prayers ?? []} jobs={jobs} userId={user.id} />
      </main>
    </>
  );
}

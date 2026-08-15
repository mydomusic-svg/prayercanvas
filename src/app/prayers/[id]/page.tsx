import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProcessButton from "./process-button";
import RenderStatus from "./render-status";
import EditableTitle from "./editable-title";
import HeroBanner from "../../hero-banner";
import type { CaptionSegment } from "@/lib/types";

export default async function PrayerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: prayer } = await supabase
    .from("prayers")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!prayer) notFound();

  const { data: renderJob } = await supabase
    .from("render_jobs")
    .select("*")
    .eq("prayer_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const captions = (prayer.captions as CaptionSegment[] | null) ?? [];
  const displayTitle =
    prayer.title ||
    (prayer.include_recipient_in_title && prayer.recipient_name
      ? `A Prayer for ${prayer.recipient_name}`
      : "Untitled Prayer");

  return (
    <>
      <HeroBanner variant="slim" />
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <EditableTitle prayerId={prayer.id} title={displayTitle} />
        {prayer.theme && (
          <span className="shrink-0 rounded-full bg-sage-100 px-3 py-1 text-xs font-medium capitalize text-sage-600">
            {prayer.theme}
          </span>
        )}
      </div>

      {prayer.transcript ? (
        <p className="rounded-lg bg-sage-50 p-4 text-sage-700">
          {prayer.transcript}
        </p>
      ) : (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-sage-300 p-5">
          <p className="text-sm text-sage-500">
            This prayer hasn&apos;t been transcribed yet. Transcription and
            theme detection usually run automatically right after you submit
            — if it didn&apos;t (for example, missing API keys), you can
            retry it here.
          </p>
          <ProcessButton prayerId={prayer.id} />
        </section>
      )}

      {captions.length > 0 && (
        <details className="rounded-lg border border-sage-200 p-4 text-sm text-sage-600">
          <summary className="cursor-pointer font-medium text-sage-800">
            Caption timing ({captions.length} segments)
          </summary>
          <ul className="mt-3 flex flex-col gap-1">
            {captions.map((c, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-16 shrink-0 tabular-nums text-sage-400">
                  {c.start.toFixed(1)}s
                </span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="rounded-lg border border-sage-200 p-5">
        <p className="text-sm font-medium">Render status</p>
        <RenderStatus
          prayerId={prayer.id}
          userId={user.id}
          title={displayTitle}
          accentColor={prayer.accent_color}
          textStyle={prayer.text_style}
          initialJob={renderJob}
        />
      </section>

      <p className="text-xs text-sage-400">
        Transcription and theme/title detection run via Claude + Whisper
        (Sprint 2). Actual video rendering still needs a render worker
        (Sprint 3) — see the README.
      </p>
      </main>
    </>
  );
}

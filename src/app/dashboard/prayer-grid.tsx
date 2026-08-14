"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PrayerActions from "../prayer-actions";
import type { RenderJob } from "@/lib/types";

type PrayerCard = {
  id: string;
  recipient_name: string | null;
  occasion: string | null;
  title: string | null;
  theme: string | null;
  created_at: string;
};

// Client half of the dashboard: server component (page.tsx) fetches the
// data, this owns the "Select" mode / checkbox / bulk-delete interactivity,
// since that state can't live in a server component. Deleting several
// prayers used to mean tapping into each one individually and confirming
// separately — tedious once someone has more than a couple of test/old
// videos to clean up.
export default function PrayerGrid({
  prayers,
  jobs,
  userId,
}: {
  prayers: PrayerCard[];
  jobs: Record<string, RenderJob | undefined>;
  userId: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !confirm(
        `Delete ${ids.length} prayer${ids.length === 1 ? "" : "s"} and ${
          ids.length === 1 ? "its" : "their"
        } video${ids.length === 1 ? "" : "s"}? This can't be undone.`
      )
    ) {
      return;
    }

    setBulkDeleting(true);
    try {
      // Best-effort storage cleanup for every selected prayer, same as the
      // single-prayer delete in prayer-actions.tsx — cascade on the prayers
      // table only removes DB rows, not the actual Storage objects.
      for (const bucket of ["prayer-audio", "prayer-videos"]) {
        for (const id of ids) {
          const { data: files } = await supabase.storage
            .from(bucket)
            .list(`${userId}/${id}`);
          if (files && files.length > 0) {
            await supabase.storage
              .from(bucket)
              .remove(files.map((f) => `${userId}/${id}/${f.name}`));
          }
        }
      }

      const { error } = await supabase.from("prayers").delete().in("id", ids);
      if (error) throw error;

      exitSelectMode();
      router.refresh();
    } catch {
      alert("Something went wrong deleting those prayers. Try again in a moment.");
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Prayers</h1>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <button
              onClick={exitSelectMode}
              className="rounded-full border border-sage-300 px-4 py-2 text-sm text-sage-700 transition hover:bg-sage-50"
            >
              Cancel
            </button>
          ) : (
            prayers.length > 0 && (
              <button
                onClick={() => setSelectMode(true)}
                className="rounded-full border border-sage-300 px-4 py-2 text-sm text-sage-700 transition hover:bg-sage-50"
              >
                Select
              </button>
            )
          )}
          <Link
            href="/create"
            className="rounded-full bg-sage-600 px-5 py-2 text-sm text-white transition hover:bg-sage-700"
          >
            + New Prayer
          </Link>
        </div>
      </div>

      {!prayers || prayers.length === 0 ? (
        <p className="text-sage-500">
          You haven&apos;t created a prayer yet.{" "}
          <Link href="/create" className="underline">
            Create your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
          {prayers.map((prayer) => {
            const job = jobs[prayer.id];
            const displayTitle =
              prayer.title ||
              (prayer.recipient_name
                ? `A Prayer for ${prayer.recipient_name}`
                : "Untitled Prayer");
            const isSelected = selected.has(prayer.id);

            const card = (
              <>
                <div className="relative block aspect-[9/16] w-full bg-sage-100">
                  {job?.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={job.thumbnail_url}
                      alt={displayTitle}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-sage-400">
                      {job?.status === "failed"
                        ? "Render failed"
                        : job
                          ? "Rendering…"
                          : "No render yet"}
                    </div>
                  )}
                  {job?.status === "complete" && !selectMode && (
                    <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                      ▶ Play
                    </span>
                  )}
                  {selectMode && (
                    <div
                      className={`absolute inset-0 flex items-start justify-end p-3 transition ${
                        isSelected ? "bg-sage-900/30" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold transition ${
                          isSelected
                            ? "border-sage-600 bg-sage-600 text-white"
                            : "border-white bg-white/70 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 font-medium">{displayTitle}</span>
                    {prayer.theme && (
                      <span className="shrink-0 rounded-full bg-sage-100 px-2 py-0.5 text-xs capitalize text-sage-600">
                        {prayer.theme}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-sage-400">
                    {new Date(prayer.created_at).toLocaleDateString()}
                  </p>

                  {!selectMode && (
                    <div className="mt-1">
                      <PrayerActions
                        prayerId={prayer.id}
                        userId={userId}
                        videoUrl={
                          job?.status === "complete" ? (job.output_url ?? null) : null
                        }
                        title={displayTitle}
                        compact
                      />
                    </div>
                  )}
                </div>
              </>
            );

            return (
              <li
                key={prayer.id}
                className={`flex flex-col overflow-hidden rounded-xl border transition ${
                  isSelected ? "border-sage-900" : "border-sage-200"
                }`}
              >
                {selectMode ? (
                  <button
                    type="button"
                    onClick={() => toggleSelected(prayer.id)}
                    className="flex flex-1 flex-col text-left"
                  >
                    {card}
                  </button>
                ) : (
                  <Link href={`/prayers/${prayer.id}`} className="flex flex-1 flex-col">
                    {card}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {selectMode && selected.size > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-full border border-sage-200 bg-white px-5 py-3 shadow-lg">
          <span className="text-sm text-sage-600">
            {selected.size} selected
          </span>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="rounded-full bg-red-600 px-4 py-1.5 text-sm text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {bulkDeleting ? "Deleting…" : `Delete ${selected.size}`}
          </button>
        </div>
      )}
    </>
  );
}

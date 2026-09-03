"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BIBLE_HANDOFF_KEY,
  formatVerseSelection,
  formatCitation,
  type BibleVerse,
  type BibleTranslation,
} from "@/lib/bible";
import VerseBanner from "./verse-banner";

/**
 * Today's verse, with one tap to turn it into a prayer.
 *
 * The button is the point. Every Bible app has a verse of the day and it
 * ends in reading it; here it ends in the thing this app exists to make.
 */

/**
 * Which passage today gets.
 *
 * Days since the epoch in UTC, modulo the pool size. UTC rather than the
 * device's clock so that two people in different timezones discussing
 * "today's verse" are talking about the same one — the alternative gives
 * Sydney and Los Angeles different verses for most of the day.
 */
function positionForToday(poolSize: number): number {
  if (poolSize <= 0) return 1;
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const days = Math.floor(utcMidnight / 86_400_000);
  return (days % poolSize) + 1;
}

export default function VerseOfTheDay({
  translation = "KJV",
}: {
  translation?: BibleTranslation;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [verses, setVerses] = useState<BibleVerse[] | null>(null);
  const [reference, setReference] = useState<string>("");
  const [theme, setTheme] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("verse_of_the_day")
        .select("position", { count: "exact", head: true });
      if (!count) {
        if (!cancelled) setFailed(true);
        return;
      }

      const { data: pick } = await supabase
        .from("verse_of_the_day")
        .select("book, chapter, verse_start, verse_end, theme")
        .eq("position", positionForToday(count))
        .maybeSingle();
      if (!pick) {
        if (!cancelled) setFailed(true);
        return;
      }

      // Only the reference is stored, so the words come from the same table
      // the reader browses — and in their translation.
      const { data: rows } = await supabase
        .from("bible_verses")
        .select("id, translation, book_order, book, chapter, verse, text")
        .eq("translation", translation)
        .eq("book", pick.book as string)
        .eq("chapter", pick.chapter as number)
        .gte("verse", pick.verse_start as number)
        .lte("verse", pick.verse_end as number)
        .order("verse", { ascending: true });

      if (cancelled) return;
      const found = (rows as BibleVerse[]) ?? [];
      if (found.length === 0) {
        setFailed(true);
        return;
      }
      setVerses(found);
      setReference(formatCitation(found, translation));
      setTheme((pick.theme as string | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, translation]);

  function makePrayer() {
    if (!verses) return;
    const text = formatVerseSelection(verses, translation);
    const citation = formatCitation(verses, translation);
    try {
      sessionStorage.setItem(
        BIBLE_HANDOFF_KEY,
        JSON.stringify({ text, citation })
      );
      router.push("/create?from=bible");
    } catch {
      router.push(
        `/create?text=${encodeURIComponent(text)}&ref=${encodeURIComponent(citation)}`
      );
    }
  }

  // A card that failed to load is worse than no card — it makes the whole
  // page look broken over something entirely optional.
  if (failed) return null;

  if (!verses) {
    return (
      <section className="overflow-hidden rounded-xl border border-sage-200 bg-white/60">
        {/* Same height as the real banner, so the card does not jump when
            the verse arrives. */}
        <div className="h-28 animate-pulse bg-sage-100 sm:h-36" />
        <div className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-sage-500">
            Today&apos;s verse
          </p>
          <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-sage-100" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-sage-100" />
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-sage-200 bg-white/70">
      {/* The label sits ON the banner rather than above it — the banner is
          the card's header, not a decoration stacked in front of one. */}
      <div className="relative">
        <VerseBanner theme={theme} />
        <p className="absolute left-5 top-4 text-xs font-semibold uppercase tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]">
          Today&apos;s verse
        </p>
      </div>
      <div className="flex flex-col gap-4 p-5">
      <blockquote className="font-headline text-xl leading-relaxed text-sage-900">
        {verses.map((v) => v.text.trim()).join(" ")}
      </blockquote>
      <p className="text-sm text-sage-500">{reference}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={makePrayer}
          className="rounded-full bg-sage-600 px-4 py-2 text-sm text-white transition hover:bg-sage-700"
        >
          Make this a prayer
        </button>
        <button
          onClick={() => router.push("/bible")}
          className="text-sm text-sage-600 underline"
        >
          Read it in context
        </button>
      </div>
      </div>
    </section>
  );
}

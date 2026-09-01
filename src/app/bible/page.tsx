"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BIBLE_BOOKS,
  BIBLE_TRANSLATIONS,
  BIBLE_HANDOFF_KEY,
  formatVerseSelection,
  type BibleVerse,
  type BibleTranslation,
} from "@/lib/bible";

/**
 * Browse, search, and turn scripture into a prayer video.
 *
 * Only public-domain translations are offered (see 0021_bible.sql): the KJV
 * and the World English Bible. Every modern translation is under copyright,
 * and burning its text into a video people then send to each other is
 * redistribution, not quotation.
 */
export default function BiblePage() {
  const router = useRouter();
  const supabase = createClient();

  const [translation, setTranslation] = useState<BibleTranslation>("KJV");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BibleVerse[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [book, setBook] = useState<string | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [chapterCount, setChapterCount] = useState(0);
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected verses, keyed by id so a verse found through search and the
  // same verse seen while reading a chapter can never both be added.
  const [selected, setSelected] = useState<Map<number, BibleVerse>>(new Map());

  const toggle = useCallback((verse: BibleVerse) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(verse.id)) next.delete(verse.id);
      else next.set(verse.id, verse);
      return next;
    });
  }, []);

  // How many chapters this book has, asked of the data rather than kept in
  // a hardcoded table — the two translations agree on chapter counts, and
  // one fewer list to keep in step with the seeded text is worth a query.
  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("bible_verses")
        .select("chapter")
        .eq("translation", translation)
        .eq("book", book)
        .order("chapter", { ascending: false })
        .limit(1);
      if (!cancelled) setChapterCount(data?.[0]?.chapter ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [book, translation, supabase]);

  useEffect(() => {
    if (!book || !chapter) {
      setVerses([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: readError } = await supabase
        .from("bible_verses")
        .select("id, translation, book_order, book, chapter, verse, text")
        .eq("translation", translation)
        .eq("book", book)
        .eq("chapter", chapter)
        .order("verse", { ascending: true });
      if (cancelled) return;
      if (readError) setError(readError.message);
      setVerses((data as BibleVerse[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [book, chapter, translation, supabase]);

  // CHAPTER PAGING.
  //
  // Reading straight through is the normal way to use a Bible, and having to
  // go back to the chapter grid between every chapter makes that tedious.
  // These walk the whole canon rather than stopping at a book boundary: past
  // the last chapter of Malachi is Matthew 1, and back from Genesis 1 is
  // nowhere, so the button disables.
  async function chaptersIn(targetBook: string): Promise<number> {
    const { data } = await supabase
      .from("bible_verses")
      .select("chapter")
      .eq("translation", translation)
      .eq("book", targetBook)
      .order("chapter", { ascending: false })
      .limit(1);
    return data?.[0]?.chapter ?? 0;
  }

  async function step(delta: 1 | -1) {
    if (!book || !chapter) return;
    const target = chapter + delta;

    // Still inside this book — the common case.
    if (target >= 1 && target <= chapterCount) {
      setChapter(target);
      window.scrollTo({ top: 0 });
      return;
    }

    const bookIdx = BIBLE_BOOKS.indexOf(book);
    const nextIdx = bookIdx + delta;
    if (nextIdx < 0 || nextIdx >= BIBLE_BOOKS.length) return;

    const nextBook = BIBLE_BOOKS[nextIdx];
    // Going forward always lands on chapter 1; going back has to land on the
    // previous book's LAST chapter, which means asking how many it has.
    const landing = delta === 1 ? 1 : await chaptersIn(nextBook);
    if (landing < 1) return;
    setBook(nextBook);
    setChapter(landing);
    window.scrollTo({ top: 0 });
  }

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    // search_bible wraps websearch_to_tsquery, which stems ("comfort" finds
    // "comforted") and tolerates the punctuation a person actually types.
    const { data, error: searchError } = await supabase.rpc("search_bible", {
      q,
      translation_filter: translation,
      max_results: 60,
    });
    if (searchError) setError(searchError.message);
    setResults((data as BibleVerse[]) ?? []);
    setSearching(false);
  }

  // Hand the chosen verses to the create page. sessionStorage rather than a
  // query string: a few verses of scripture plus a reference runs well past
  // a comfortable URL length, and this text is only ever meant for the very
  // next page.
  function makePrayerVideo() {
    const text = formatVerseSelection([...selected.values()], translation);
    try {
      sessionStorage.setItem(BIBLE_HANDOFF_KEY, text);
    } catch {
      // Private mode or blocked storage — fall through to the query string,
      // which is lossy for very long selections but better than nothing.
      router.push(`/create?text=${encodeURIComponent(text.slice(0, 1500))}`);
      return;
    }
    router.push("/create?from=bible");
  }

  const selectedList = [...selected.values()].sort(
    (a, b) =>
      a.book_order - b.book_order || a.chapter - b.chapter || a.verse - b.verse
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 pb-40">
      <div className="flex flex-col gap-2">
        <h1 className="font-headline text-3xl font-bold">The Bible</h1>
        <p className="text-sm text-sage-600">
          Read, search, and turn any passage into a prayer video.
        </p>
      </div>

      <div className="flex gap-2 rounded-full bg-sage-100 p-1">
        {BIBLE_TRANSLATIONS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTranslation(t.id);
              setResults(null);
            }}
            className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition ${
              translation === t.id
                ? "bg-white text-sage-900 shadow-sm"
                : "text-sage-600 hover:text-sage-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="-mt-4 text-xs text-sage-400">
        {BIBLE_TRANSLATIONS.find((t) => t.id === translation)?.note}
      </p>

      <form onSubmit={runSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a word or phrase…"
          className="flex-1 rounded-lg border border-sage-300 px-4 py-2 text-base"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded-full bg-sage-600 px-5 py-2 text-white transition hover:bg-sage-700 disabled:opacity-50"
        >
          {searching ? "…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {results !== null ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {results.length === 0
                ? "No verses found."
                : `${results.length} verse${results.length === 1 ? "" : "s"}`}
            </p>
            <button
              onClick={() => {
                setResults(null);
                setQuery("");
              }}
              className="text-sm text-sage-500 underline"
            >
              Clear search
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {results.map((v) => (
              <VerseRow
                key={v.id}
                verse={v}
                showReference
                selected={selected.has(v.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        </section>
      ) : !book ? (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">Choose a book</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BIBLE_BOOKS.map((b) => (
              <button
                key={b}
                onClick={() => {
                  setBook(b);
                  setChapter(null);
                }}
                className="rounded-lg border border-sage-300 px-3 py-2 text-sm transition hover:bg-sage-50"
              >
                {b}
              </button>
            ))}
          </div>
        </section>
      ) : !chapter ? (
        <section className="flex flex-col gap-3">
          <button
            onClick={() => setBook(null)}
            className="self-start text-sm text-sage-500 underline"
          >
            ← All books
          </button>
          <p className="text-sm font-medium">{book} — choose a chapter</p>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
            {Array.from({ length: chapterCount }, (_, i) => i + 1).map((c) => (
              <button
                key={c}
                onClick={() => setChapter(c)}
                className="rounded-lg border border-sage-300 px-2 py-2 text-sm transition hover:bg-sage-50"
              >
                {c}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <button
            onClick={() => setChapter(null)}
            className="self-start text-sm text-sage-500 underline"
          >
            ← {book}
          </button>
          <h2 className="font-headline text-2xl font-semibold">
            {book} {chapter}
          </h2>
          {loading ? (
            <p className="text-sm text-sage-500">Loading…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {verses.map((v) => (
                <VerseRow
                  key={v.id}
                  verse={v}
                  selected={selected.has(v.id)}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-3">
            <button
              onClick={() => step(-1)}
              disabled={book === BIBLE_BOOKS[0] && chapter === 1}
              className="rounded-full border border-sage-300 px-4 py-2 text-sm transition hover:bg-sage-50 disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="text-xs text-sage-400">
              Chapter {chapter} of {chapterCount}
            </span>
            <button
              onClick={() => step(1)}
              disabled={
                book === BIBLE_BOOKS[BIBLE_BOOKS.length - 1] &&
                chapter === chapterCount
              }
              className="rounded-full border border-sage-300 px-4 py-2 text-sm transition hover:bg-sage-50 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </section>
      )}

      {/* Selection tray. Fixed to the bottom so the count and the action stay
          reachable however far down a long chapter someone has scrolled, and
          padded for the iPhone home indicator. */}
      {selectedList.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 border-t border-sage-200 bg-white/95 backdrop-blur"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {selectedList.length} verse
                {selectedList.length === 1 ? "" : "s"} selected
              </p>
              <p className="truncate text-xs text-sage-500">
                {selectedList
                  .map((v) => `${v.book} ${v.chapter}:${v.verse}`)
                  .join(", ")}
              </p>
            </div>
            <button
              onClick={() => setSelected(new Map())}
              className="text-sm text-sage-500 underline"
            >
              Clear
            </button>
            <button
              onClick={makePrayerVideo}
              className="shrink-0 rounded-full bg-sage-600 px-4 py-2 text-sm text-white transition hover:bg-sage-700"
            >
              Make a video
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function VerseRow({
  verse,
  selected,
  onToggle,
  showReference = false,
}: {
  verse: BibleVerse;
  selected: boolean;
  onToggle: (v: BibleVerse) => void;
  showReference?: boolean;
}) {
  return (
    <button
      onClick={() => onToggle(verse)}
      className={`rounded-lg border px-4 py-3 text-left transition ${
        selected
          ? "border-sage-600 bg-sage-50"
          : "border-transparent hover:bg-sage-50"
      }`}
    >
      <span className="text-sm leading-relaxed">
        <span className="mr-2 font-semibold text-sage-500">
          {showReference ? `${verse.book} ${verse.chapter}:${verse.verse}` : verse.verse}
        </span>
        {verse.text}
      </span>
    </button>
  );
}

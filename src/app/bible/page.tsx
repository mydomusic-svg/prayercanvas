"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  BIBLE_BOOKS,
  BIBLE_TRANSLATIONS,
  BIBLE_HANDOFF_KEY,
  formatVerseSelection,
  formatCitation,
  parseReference,
  formatReference,
  OLD_TESTAMENT_BOOKS,
  NEW_TESTAMENT_BOOKS,
  MARK_STYLES,
  verseKey,
  type MarkStyle,
  type BibleVerse,
  type BibleTranslation,
} from "@/lib/bible";
import VerseOfTheDay from "../verse-of-the-day";

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

  // Reader text size. Scripture is read for a long time and often by people
  // who find small type genuinely hard, so this is an accessibility control
  // rather than a nicety — and it persists, because someone who needs large
  // type needs it every visit, not once.
  // Marks the reader has put on verses, keyed by book|chapter|verse. Loaded
  // for the chapter on screen rather than all at once — a heavy reader can
  // accumulate thousands and there is no reason to ship them all.
  const [marks, setMarks] = useState<Map<string, Set<MarkStyle>>>(new Map());
  const [bookmarks, setBookmarks] = useState<BibleVerse[] | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [commentaryRef, setCommentaryRef] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

    const [textScale, setTextScale] = useState(1);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("prayercanvas:bible-text-scale"));
      if (saved >= 1 && saved <= 2) setTextScale(saved);
    } catch {
      // Blocked storage just means the default size; not worth surfacing.
    }
  }, []);
  function cycleTextScale() {
    // 1 -> 1.25 -> 1.5 -> 1.75 -> back to 1. A cycle rather than +/- buttons
    // keeps it to one control in a header that is already busy on a phone.
    const next = textScale >= 1.75 ? 1 : Number((textScale + 0.25).toFixed(2));
    setTextScale(next);
    try {
      localStorage.setItem("prayercanvas:bible-text-scale", String(next));
    } catch {
      // Non-fatal — the size still applies for this visit.
    }
  }

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

  const loadMarks = useCallback(async () => {
    if (!book || !chapter) return;
    const { data } = await supabase
      .from("bible_marks")
      .select("book, chapter, verse, style")
      .eq("translation", translation)
      .eq("book", book)
      .eq("chapter", chapter);
    const next = new Map<string, Set<MarkStyle>>();
    for (const m of data ?? []) {
      const k = verseKey(m.book as string, m.chapter as number, m.verse as number);
      if (!next.has(k)) next.set(k, new Set());
      next.get(k)!.add(m.style as MarkStyle);
    }
    setMarks(next);
  }, [book, chapter, translation, supabase]);

  useEffect(() => {
    loadMarks();
  }, [loadMarks]);

  // Toggling applies to every selected verse at once. If any selected verse
  // lacks the style the whole selection gains it; only when they all already
  // have it does it come off — which is what "toggle" means for a group, and
  // avoids the checkerboard you get from flipping each verse independently.
  async function toggleMark(style: MarkStyle) {
    const chosen = [...selected.values()];
    if (chosen.length === 0) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const allHave = chosen.every((v) =>
      marks.get(verseKey(v.book, v.chapter, v.verse))?.has(style)
    );

    if (allHave) {
      for (const v of chosen) {
        await supabase
          .from("bible_marks")
          .delete()
          .eq("user_id", user.id)
          .eq("translation", translation)
          .eq("book", v.book)
          .eq("chapter", v.chapter)
          .eq("verse", v.verse)
          .eq("style", style);
      }
    } else {
      await supabase.from("bible_marks").upsert(
        chosen.map((v) => ({
          user_id: user.id,
          translation,
          book_order: v.book_order,
          book: v.book,
          chapter: v.chapter,
          verse: v.verse,
          style,
        })),
        {
          onConflict: "user_id,translation,book_order,chapter,verse,style",
          ignoreDuplicates: true,
        }
      );
    }
    await loadMarks();
    if (bookmarks !== null) await openBookmarks();
  }

  async function openBookmarks() {
    const { data: rows } = await supabase
      .from("bible_marks")
      .select("book_order, book, chapter, verse")
      .eq("style", "bookmark")
      .eq("translation", translation)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!rows || rows.length === 0) {
      setBookmarks([]);
      return;
    }
    // Marks store coordinates, not verse ids (ids move when a translation is
    // re-seeded), so the text is fetched back here.
    const { data: verses } = await supabase
      .from("bible_verses")
      .select("id, translation, book_order, book, chapter, verse, text")
      .eq("translation", translation)
      .in("book", [...new Set(rows.map((r) => r.book as string))]);
    const wanted = new Set(rows.map((r) => verseKey(r.book as string, r.chapter as number, r.verse as number)));
    const found = ((verses as BibleVerse[]) ?? []).filter((v) =>
      wanted.has(verseKey(v.book, v.chapter, v.verse))
    );
    found.sort(
      (a, b) =>
        a.book_order - b.book_order || a.chapter - b.chapter || a.verse - b.verse
    );
    setBookmarks(found);
    setResults(null);
  }

  async function explainSelection() {
    const chosen = [...selected.values()].sort(
      (a, b) => a.chapter - b.chapter || a.verse - b.verse
    );
    if (chosen.length === 0) return;
    setExplaining(true);
    setCommentary(null);
    setError(null);
    try {
      const first = chosen[0];
      const last = chosen[chosen.length - 1];
      const res = await fetch("/api/bible/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translation,
          book: first.book,
          bookOrder: first.book_order,
          chapter: first.chapter,
          verseStart: first.verse,
          verseEnd: last.verse,
          reference: formatReference(chosen),
          text: chosen.map((v) => v.text).join(" "),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't load an explanation.");
      } else {
        setCommentary(data.commentary);
        setCommentaryRef(data.reference);
      }
    } catch {
      setError("Couldn't load an explanation.");
    } finally {
      setExplaining(false);
    }
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

    // A REFERENCE IS NOT A SEARCH.
    //
    // Someone typing "John 3:16" knows exactly what they want; running that
    // through full-text search would rank verses containing the word "john"
    // and never show them the one verse they asked for. So a parseable
    // reference jumps straight there and pre-selects the verses, ready to
    // send into a prayer. Anything that isn't a reference — "the lord is my
    // shepherd", "comfort" — falls through to the keyword search below.
    const ref = parseReference(q);
    if (ref) {
      const { data, error: refError } = await supabase
        .from("bible_verses")
        .select("id, translation, book_order, book, chapter, verse, text")
        .eq("translation", translation)
        .eq("book", ref.book)
        .eq("chapter", ref.chapter)
        .order("verse", { ascending: true });

      if (refError) {
        setError(refError.message);
        setSearching(false);
        return;
      }
      const chapterVerses = (data as BibleVerse[]) ?? [];
      if (chapterVerses.length === 0) {
        setError(
          `${ref.book} ${ref.chapter} isn't in this translation — check the chapter number.`
        );
        setSearching(false);
        return;
      }

      // Show the chapter in the reader rather than as a result list, so the
      // surrounding verses are right there to add.
      setResults(null);
      setBook(ref.book);
      setChapter(ref.chapter);
      setQuery("");

      // Pre-select the requested verses. Asking for a whole chapter with no
      // verse selects nothing — selecting 150 verses of Psalm 119 for
      // someone who typed "Psalm 119" would be a hostile guess.
      if (ref.verseStart !== null) {
        const end = ref.verseEnd ?? ref.verseStart;
        const wanted = chapterVerses.filter(
          (v) => v.verse >= ref.verseStart! && v.verse <= end
        );
        if (wanted.length === 0) {
          setError(
            `${ref.book} ${ref.chapter} only has ${chapterVerses.length} verses.`
          );
        } else {
          setSelected(new Map(wanted.map((v) => [v.id, v])));
        }
      }
      setSearching(false);
      return;
    }

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
    const chosen = [...selected.values()];
    const text = formatVerseSelection(chosen, translation);
    const citation = formatCitation(chosen, translation);
    try {
      // Text and citation travel together as JSON so the create page can
      // keep them apart — the words get spoken, the citation gets drawn
      // along the bottom of the video (0023_scripture_reference.sql).
      sessionStorage.setItem(
        BIBLE_HANDOFF_KEY,
        JSON.stringify({ text, citation })
      );
    } catch {
      // Private mode or blocked storage — fall through to the query string,
      // which is lossy for very long selections but better than nothing.
      router.push(
        `/create?text=${encodeURIComponent(text.slice(0, 1500))}` +
          `&ref=${encodeURIComponent(citation)}`
      );
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
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-headline text-3xl font-bold">The Bible</h1>
          <p className="text-sm text-sage-600">
            Read, search, and turn any passage into a prayer video.
          </p>
        </div>
        <button
          onClick={() => (bookmarks === null ? openBookmarks() : setBookmarks(null))}
          className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-2 text-sm transition ${
            bookmarks !== null
              ? "border-sage-600 bg-sage-600 text-white"
              : "border-sage-300 hover:bg-sage-50"
          }`}
        >
          <span aria-hidden>🔖</span>
          <span className="text-xs">Saved</span>
        </button>
        <button
          onClick={cycleTextScale}
          title={`Text size: ${Math.round(textScale * 100)}%`}
          aria-label={`Change text size, currently ${Math.round(textScale * 100)} percent`}
          className="flex shrink-0 items-center gap-1 rounded-full border border-sage-300 px-3 py-2 text-sm transition hover:bg-sage-50"
        >
          <span aria-hidden className="text-base">🔍</span>
          <span className="tabular-nums text-xs text-sage-600">
            {Math.round(textScale * 100)}%
          </span>
        </button>
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

      {/* Follows the translation toggle above it, so switching to WEB
          re-renders today's verse in WEB too. */}
      <VerseOfTheDay translation={translation} />

      <form onSubmit={runSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A verse like John 3:16, or a word like comfort…"
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

      {commentary && (
        <section className="flex flex-col gap-3 rounded-xl border border-sage-200 bg-white/70 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Reflection</p>
              <p className="text-xs text-sage-500">{commentaryRef}</p>
            </div>
            <button
              onClick={() => setCommentary(null)}
              className="text-sm text-sage-500 underline"
            >
              Close
            </button>
          </div>
          {commentary.split(/\n\n+/).map((para, i) => (
            <p
              key={i}
              className="leading-relaxed text-sage-800"
              style={{ fontSize: `${14 * textScale}px` }}
            >
              {para}
            </p>
          ))}
          {/* Said plainly rather than buried in terms: this is generated,
              it is one reading among many, and it is not a substitute for
              a person. */}
          <p className="border-t border-sage-100 pt-3 text-xs text-sage-400">
            A reflection to sit with, written by AI — one way of reading this
            passage, not the only one. For anything weighing heavily, talk to
            someone you trust.
          </p>
        </section>
      )}

      {bookmarks !== null ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {bookmarks.length === 0
                ? "No saved verses yet."
                : `${bookmarks.length} saved verse${bookmarks.length === 1 ? "" : "s"}`}
            </p>
            <button
              onClick={() => setBookmarks(null)}
              className="text-sm text-sage-500 underline"
            >
              Back to reading
            </button>
          </div>
          {bookmarks.length === 0 && (
            <p className="text-sm text-sage-500">
              Select a verse while reading and choose 🔖 Bookmark to keep it
              here.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {bookmarks.map((v) => (
              <VerseRow
                key={v.id}
                verse={v}
                showReference
                selected={selected.has(v.id)}
                onToggle={toggle}
                scale={textScale}
                styles={marks.get(verseKey(v.book, v.chapter, v.verse))}
              />
            ))}
          </div>
        </section>
      ) : results !== null ? (
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
                scale={textScale}
                styles={marks.get(verseKey(v.book, v.chapter, v.verse))}
              />
            ))}
          </div>
        </section>
      ) : !book ? (
        <section className="flex flex-col gap-3">
          {/* The canon's two halves, labelled. A flat list of 66 names hides
              the single most basic fact about the Bible's structure, and
              someone looking for Matthew shouldn't have to know it is the
              40th book to find where the New Testament starts. */}
          {[
            ["Old Testament", OLD_TESTAMENT_BOOKS],
            ["New Testament", NEW_TESTAMENT_BOOKS],
          ].map(([label, books]) => (
            <div key={label as string} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold text-sage-700">
                  {label as string}
                </p>
                <span className="text-xs text-sage-400">
                  {(books as string[]).length} books
                </span>
                <span className="h-px flex-1 bg-sage-200" />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(books as string[]).map((b) => (
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
            </div>
          ))}
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
                  scale={textScale}
                  styles={marks.get(verseKey(v.book, v.chapter, v.verse))}
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
          {/* Marking row above the actions: these are the quick, repeated
              gestures while studying, and they should not be crowded in
              beside the two buttons that navigate away. */}
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 pt-3">
            {MARK_STYLES.map((m) => {
              const chosen = [...selected.values()];
              const active =
                chosen.length > 0 &&
                chosen.every((v) =>
                  marks.get(verseKey(v.book, v.chapter, v.verse))?.has(m.id)
                );
              return (
                <button
                  key={m.id}
                  onClick={() => toggleMark(m.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    active
                      ? "border-sage-600 bg-sage-600 text-white"
                      : "border-sage-300 hover:bg-sage-50"
                  }`}
                >
                  <span aria-hidden className="mr-1">{m.icon}</span>
                  {m.label}
                </button>
              );
            })}
          </div>
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
              onClick={explainSelection}
              disabled={explaining}
              className="shrink-0 rounded-full border border-sage-400 px-3 py-2 text-sm transition hover:bg-sage-50 disabled:opacity-50"
            >
              {explaining ? "…" : "Explain"}
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
  scale = 1,
  styles,
}: {
  verse: BibleVerse;
  selected: boolean;
  onToggle: (v: BibleVerse) => void;
  showReference?: boolean;
  scale?: number;
  styles?: Set<MarkStyle>;
}) {
  // A verse can carry several marks at once, so these compose rather than
  // pick one. Highlight is a background, bold and underline are type
  // treatments, and a bookmark shows as a tab in the margin — none of them
  // conflict, and a reader who has used all four should see all four.
  const highlighted = styles?.has("highlight");
  const bookmarked = styles?.has("bookmark");
  return (
    <button
      onClick={() => onToggle(verse)}
      className={`relative rounded-lg border px-4 py-3 text-left transition ${
        selected
          ? "border-sage-600 bg-sage-50"
          : highlighted
            ? "border-transparent bg-amber-100 hover:bg-amber-200"
            : "border-transparent hover:bg-sage-50"
      }`}
    >
      {bookmarked && (
        <span
          aria-label="Bookmarked"
          className="absolute right-2 top-2 text-xs"
        >
          🔖
        </span>
      )}
      {/* Scaled from the 14px base rather than swapping Tailwind classes, so
          the magnifier can offer in-between steps and the verse-number and
          body text grow together. */}
      <span
        className={`leading-relaxed ${styles?.has("bold") ? "font-semibold" : ""} ${
          styles?.has("underline") ? "underline decoration-sage-500 underline-offset-4" : ""
        }`}
        style={{ fontSize: `${14 * scale}px` }}
      >
        <span className="mr-2 font-semibold text-sage-500">
          {showReference ? `${verse.book} ${verse.chapter}:${verse.verse}` : verse.verse}
        </span>
        {verse.text}
      </span>
    </button>
  );
}

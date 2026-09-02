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
  matchTopic,
  type BibleTopic,
  type TopicPassage,
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

  // Topics: the curated bridge from a feeling to a passage. Loaded once —
  // eighteen rows, and every search has to check them before falling through
  // to full-text search.
  const [topics, setTopics] = useState<BibleTopic[]>([]);
  const [topic, setTopic] = useState<BibleTopic | null>(null);
  const [topicVerses, setTopicVerses] = useState<BibleVerse[] | null>(null);

  // Notes on a verse, keyed by book|chapter|verse for the open chapter.
  // NOT keyed by translation: a thought about Psalm 23:4 is a thought about
  // that verse, not about the KJV's wording of it, and it would be a nasty
  // surprise for your own writing to vanish because you flipped to WEB.
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [noteFor, setNoteFor] = useState<BibleVerse | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteList, setNoteList] = useState<
    { verse: BibleVerse; body: string; updated_at: string }[] | null
  >(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("bible_topics")
        .select("slug, label, position, aliases")
        .order("position", { ascending: true });
      if (!cancelled) setTopics((data as BibleTopic[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const loadNotes = useCallback(async () => {
    if (!book || !chapter) return;
    const { data } = await supabase
      .from("bible_notes")
      .select("book, chapter, verse, body")
      .eq("book", book)
      .eq("chapter", chapter);
    const next = new Map<string, string>();
    for (const n of data ?? []) {
      next.set(
        verseKey(n.book as string, n.chapter as number, n.verse as number),
        n.body as string
      );
    }
    setNotes(next);
  }, [book, chapter, supabase]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // NOTES.
  //
  // One note per verse, and only ever for a single selected verse — a note
  // spread across a five-verse selection has no home to go back to, and
  // silently writing the same words onto five rows is worse than refusing.
  function openNoteEditor() {
    const chosen = [...selected.values()];
    if (chosen.length !== 1) return;
    const v = chosen[0];
    setNoteFor(v);
    setNoteDraft(notes.get(verseKey(v.book, v.chapter, v.verse)) ?? "");
  }

  async function saveNote() {
    if (!noteFor) return;
    const body = noteDraft.trim();
    setSavingNote(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingNote(false);
      router.push("/login");
      return;
    }
    if (body === "") {
      // Clearing the box deletes the note. An empty note is not a note, and
      // making someone hunt for a separate Delete to undo a thought they
      // changed their mind about is friction for nothing.
      await supabase
        .from("bible_notes")
        .delete()
        .eq("user_id", user.id)
        .eq("book_order", noteFor.book_order)
        .eq("chapter", noteFor.chapter)
        .eq("verse", noteFor.verse);
    } else {
      await supabase.from("bible_notes").upsert(
        {
          user_id: user.id,
          book_order: noteFor.book_order,
          book: noteFor.book,
          chapter: noteFor.chapter,
          verse: noteFor.verse,
          body,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,book_order,chapter,verse" }
      );
    }
    setSavingNote(false);
    setNoteFor(null);
    setNoteDraft("");
    await loadNotes();
    if (noteList !== null) await openNotes();
  }

  async function openNotes() {
    const { data: rows } = await supabase
      .from("bible_notes")
      .select("book_order, book, chapter, verse, body, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (!rows || rows.length === 0) {
      setNoteList([]);
      setBookmarks(null);
      setResults(null);
      return;
    }
    // Notes store coordinates, not verse ids, so the words are fetched back
    // in whichever translation the reader is currently in.
    const filters = rows
      .map(
        (r) =>
          `and(book_order.eq.${r.book_order},chapter.eq.${r.chapter},verse.eq.${r.verse})`
      )
      .join(",");
    const { data: verses } = await supabase
      .from("bible_verses")
      .select("id, translation, book_order, book, chapter, verse, text")
      .eq("translation", translation)
      .or(filters);
    const byKey = new Map(
      ((verses as BibleVerse[]) ?? []).map((v) => [
        verseKey(v.book, v.chapter, v.verse),
        v,
      ])
    );
    const out: { verse: BibleVerse; body: string; updated_at: string }[] = [];
    for (const r of rows) {
      const v = byKey.get(
        verseKey(r.book as string, r.chapter as number, r.verse as number)
      );
      if (v) out.push({ verse: v, body: r.body as string, updated_at: r.updated_at as string });
    }
    setNoteList(out);
    setBookmarks(null);
    setResults(null);
    setTopic(null);
  }

  // TOPICS.
  //
  // Passages are references, resolved to text here in the reader's chosen
  // translation — one copy of scripture serves both, the same rule as the
  // verse of the day. Curated order is kept rather than canonical order:
  // the first passage under "anxiety" is Philippians 4:6 because it is the
  // one that answers, not because Philippians sorts early.
  const openTopic = useCallback(
    async (t: BibleTopic) => {
      setTopic(t);
      setTopicVerses(null);
      setResults(null);
      setBookmarks(null);
      setNoteList(null);
      setError(null);
      const { data: passages } = await supabase
        .from("bible_topic_passages")
        .select("topic_slug, position, book_order, book, chapter, verse_start, verse_end")
        .eq("topic_slug", t.slug)
        .order("position", { ascending: true });
      const list = (passages as TopicPassage[]) ?? [];
      if (list.length === 0) {
        setTopicVerses([]);
        return;
      }
      const filters = list
        .map(
          (r) =>
            `and(book_order.eq.${r.book_order},chapter.eq.${r.chapter},verse.gte.${r.verse_start},verse.lte.${r.verse_end})`
        )
        .join(",");
      const { data: verses } = await supabase
        .from("bible_verses")
        .select("id, translation, book_order, book, chapter, verse, text")
        .eq("translation", translation)
        .or(filters);
      const pool = (verses as BibleVerse[]) ?? [];
      const ordered: BibleVerse[] = [];
      for (const pass of list) {
        const inRange = pool
          .filter(
            (v) =>
              v.book_order === pass.book_order &&
              v.chapter === pass.chapter &&
              v.verse >= pass.verse_start &&
              v.verse <= pass.verse_end
          )
          .sort((a, b) => a.verse - b.verse);
        ordered.push(...inRange);
      }
      setTopicVerses(ordered);
      window.scrollTo({ top: 0 });
    },
    [supabase, translation]
  );

  // Re-resolve an open topic when the translation changes underneath it.
  useEffect(() => {
    if (topic) openTopic(topic);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translation]);

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

    // A TOPIC BEATS FULL-TEXT SEARCH, and has to be checked before it.
    //
    // Search the KJV for "anxiety" and you get nothing — the word is not in
    // it. Neither is "anxious" or "worry". Someone typing the thing they
    // actually feel would get an empty page and conclude the Bible has
    // nothing to say about it. The topic table answers first, and the topic
    // view still offers "search the text for …" for anyone who meant the
    // literal word.
    const matched = matchTopic(q, topics);
    if (matched) {
      setQuery("");
      setSearching(false);
      await openTopic(matched);
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
    setTopic(null);
    setBookmarks(null);
    setNoteList(null);
    setSearching(false);
  }

  // The escape hatch from a topic to the literal word, skipping the topic
  // table so "work" can mean the word "work" when that is what was meant.
  async function searchTextFor(word: string) {
    setSearching(true);
    setTopic(null);
    setError(null);
    const { data, error: searchError } = await supabase.rpc("search_bible", {
      q: word,
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
          onClick={() => (noteList === null ? openNotes() : setNoteList(null))}
          className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-2 text-sm transition ${
            noteList !== null
              ? "border-sage-600 bg-sage-600 text-white"
              : "border-sage-300 hover:bg-sage-50"
          }`}
        >
          <span aria-hidden>✎</span>
          <span className="text-xs">Notes</span>
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
          placeholder="John 3:16, a word like comfort, or how you feel…"
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
      ) : noteList !== null ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {noteList.length === 0
                ? "No notes yet."
                : `${noteList.length} note${noteList.length === 1 ? "" : "s"}`}
            </p>
            <button
              onClick={() => setNoteList(null)}
              className="text-sm text-sage-500 underline"
            >
              Back to reading
            </button>
          </div>
          {noteList.length === 0 && (
            <p className="text-sm text-sage-500">
              Select a single verse while reading and choose ✎ Note to write
              something down. Your notes are private to you.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {noteList.map(({ verse, body }) => (
              <div key={verse.id} className="flex flex-col gap-1">
                <VerseRow
                  verse={verse}
                  showReference
                  selected={selected.has(verse.id)}
                  onToggle={toggle}
                  scale={textScale}
                  styles={marks.get(verseKey(verse.book, verse.chapter, verse.verse))}
                />
                <p
                  className="ml-4 border-l-2 border-sage-300 pl-3 italic leading-relaxed text-sage-700"
                  style={{ fontSize: `${13 * textScale}px` }}
                >
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : topic ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-headline text-2xl font-semibold">
                {topic.label}
              </h2>
              <p className="text-xs text-sage-500">
                {topicVerses === null
                  ? "Finding passages…"
                  : `${topicVerses.length} verse${topicVerses.length === 1 ? "" : "s"}, chosen for this`}
              </p>
            </div>
            <button
              onClick={() => {
                setTopic(null);
                setTopicVerses(null);
              }}
              className="text-sm text-sage-500 underline"
            >
              Back to books
            </button>
          </div>
          {topicVerses !== null && (
            <div className="flex flex-col gap-2">
              {topicVerses.map((v) => (
                <VerseRow
                  key={v.id}
                  verse={v}
                  showReference
                  selected={selected.has(v.id)}
                  onToggle={toggle}
                  scale={textScale}
                  styles={marks.get(verseKey(v.book, v.chapter, v.verse))}
                  hasNote={notes.has(verseKey(v.book, v.chapter, v.verse))}
                />
              ))}
            </div>
          )}
          {/* These passages are picked by hand, not found by searching — so
              say so, and leave the literal-word search one tap away for
              anyone who meant the word rather than the feeling. */}
          <p className="border-t border-sage-100 pt-3 text-xs text-sage-400">
            A hand-picked selection, not a complete list.{" "}
            <button
              onClick={() => searchTextFor(topic.slug)}
              className="underline"
            >
              Search the text for “{topic.slug}” instead
            </button>
          </p>
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
          {/* BROWSE BY TOPIC, above the books.
              Someone who opens a Bible knowing which book they want can
              scroll past this in a second. Someone who opens it because
              they feel something and don't know where to look has, until
              now, had nowhere to start — the book grid assumes you already
              know the answer. */}
          {topics.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <p className="text-sm font-semibold text-sage-700">
                  Browse by topic
                </p>
                <span className="h-px flex-1 bg-sage-200" />
              </div>
              <div className="flex flex-wrap gap-2">
                {topics.map((t) => (
                  <button
                    key={t.slug}
                    onClick={() => openTopic(t)}
                    className="rounded-full border border-sage-300 px-3 py-1.5 text-sm transition hover:bg-sage-50"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
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
                  hasNote={notes.has(verseKey(v.book, v.chapter, v.verse))}
                  note={notes.get(verseKey(v.book, v.chapter, v.verse))}
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

      {/* NOTE EDITOR.
          A panel rather than a browser prompt: notes run to paragraphs, and
          the verse has to stay visible above the box you are writing about
          it in. */}
      {noteFor && (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
          <div
            className="flex w-full max-w-lg flex-col gap-3 rounded-t-2xl bg-white p-5 sm:rounded-2xl"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          >
            <div>
              <p className="text-sm font-semibold">
                {noteFor.book} {noteFor.chapter}:{noteFor.verse}
              </p>
              <p
                className="mt-1 leading-relaxed text-sage-600"
                style={{ fontSize: `${13 * textScale}px` }}
              >
                {noteFor.text}
              </p>
            </div>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              autoFocus
              rows={6}
              placeholder="What do you want to remember about this verse?"
              className="w-full rounded-lg border border-sage-300 px-3 py-2 text-base leading-relaxed"
            />
            <p className="text-xs text-sage-400">
              Private to you. Clearing the box removes the note.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setNoteFor(null);
                  setNoteDraft("");
                }}
                className="text-sm text-sage-500 underline"
              >
                Cancel
              </button>
              <button
                onClick={saveNote}
                disabled={savingNote}
                className="rounded-full bg-sage-600 px-5 py-2 text-sm text-white transition hover:bg-sage-700 disabled:opacity-50"
              >
                {savingNote ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
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
            {/* A note belongs to ONE verse, so the button only appears when
                exactly one is selected rather than appearing and then
                failing. The label says which state you are in. */}
            {selectedList.length === 1 && (
              <button
                onClick={openNoteEditor}
                className="rounded-full border border-sage-300 px-3 py-1.5 text-xs transition hover:bg-sage-50"
              >
                <span aria-hidden className="mr-1">✎</span>
                {notes.has(
                  verseKey(
                    selectedList[0].book,
                    selectedList[0].chapter,
                    selectedList[0].verse
                  )
                )
                  ? "Edit note"
                  : "Note"}
              </button>
            )}
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
  hasNote = false,
  note,
}: {
  verse: BibleVerse;
  selected: boolean;
  onToggle: (v: BibleVerse) => void;
  showReference?: boolean;
  scale?: number;
  styles?: Set<MarkStyle>;
  hasNote?: boolean;
  note?: string;
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
      {(bookmarked || hasNote) && (
        <span className="absolute right-2 top-2 text-xs">
          {bookmarked && <span aria-label="Bookmarked">🔖</span>}
          {hasNote && <span aria-label="Has a note">✎</span>}
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
      {/* The note shown under the verse it belongs to while reading. A note
          you have to go looking for is a note you forget you wrote. */}
      {note && (
        <span
          className="mt-2 block border-l-2 border-sage-300 pl-3 italic leading-relaxed text-sage-600"
          style={{ fontSize: `${12.5 * scale}px` }}
        >
          {note}
        </span>
      )}
    </button>
  );
}

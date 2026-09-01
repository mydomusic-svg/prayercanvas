/**
 * Shared Bible constants and helpers (see supabase/migrations/0021_bible.sql).
 */

export type BibleTranslation = "KJV" | "WEB";

export interface BibleVerse {
  id: number;
  translation: BibleTranslation;
  book_order: number;
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

/**
 * ONLY PUBLIC-DOMAIN TRANSLATIONS BELONG HERE.
 *
 * A prayer video carries the verse text inside it and is then shared onward,
 * which is redistribution rather than quotation. That is fine for these two
 * and not fine for any modern translation — NIV, ESV, NLT and the rest are
 * all under copyright and would need a signed publisher agreement first.
 */
export const BIBLE_TRANSLATIONS: {
  id: BibleTranslation;
  label: string;
  note: string;
}[] = [
  {
    id: "KJV",
    label: "King James Version",
    note: "The traditional wording, 1611. Public domain.",
  },
  {
    id: "WEB",
    label: "World English Bible",
    note: "Modern English, easier to read aloud. Public domain.",
  },
];

/** Canonical order — must match the BOOKS list in scripts/seed-bible.mjs. */
export const BIBLE_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
  "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
  "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
  "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
  "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
  "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
];

/** sessionStorage key used to hand selected verses to the create page. */
export const BIBLE_HANDOFF_KEY = "prayercanvas:bible-text";

/**
 * Turns a verse selection into the text a narrator will read.
 *
 * Verse NUMBERS are deliberately left out of the body — "The Lord is my
 * shepherd; I shall not want" is a prayer, and "1 The Lord is my shepherd 2
 * He maketh me" is a numbered list read aloud. Consecutive verses are joined
 * into flowing prose, and the reference is appended once at the end so the
 * passage is still properly cited in the video and its captions.
 */
export function formatVerseSelection(
  verses: BibleVerse[],
  translation: BibleTranslation
): string {
  if (verses.length === 0) return "";

  const sorted = [...verses].sort(
    (a, b) =>
      a.book_order - b.book_order || a.chapter - b.chapter || a.verse - b.verse
  );

  const body = sorted.map((v) => v.text.trim()).join(" ");
  return `${body}\n\n— ${formatReference(sorted)} (${translation})`;
}

/**
 * Collapses a sorted selection into a readable citation: runs of consecutive
 * verses become ranges, so picking Psalm 23:1 through 23:4 cites
 * "Psalms 23:1-4" rather than listing each one.
 */
export function formatReference(sorted: BibleVerse[]): string {
  const parts: string[] = [];
  let runStart = sorted[0];
  let previous = sorted[0];

  const flush = () => {
    const sameVerse = runStart.verse === previous.verse;
    parts.push(
      sameVerse
        ? `${runStart.book} ${runStart.chapter}:${runStart.verse}`
        : `${runStart.book} ${runStart.chapter}:${runStart.verse}-${previous.verse}`
    );
  };

  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    const consecutive =
      v.book_order === previous.book_order &&
      v.chapter === previous.chapter &&
      v.verse === previous.verse + 1;
    if (!consecutive) {
      flush();
      runStart = v;
    }
    previous = v;
  }
  flush();

  return parts.join("; ");
}

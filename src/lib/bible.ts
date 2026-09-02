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
 * Verse NUMBERS are deliberately left out — "The Lord is my shepherd; I
 * shall not want" is a prayer, and "1 The Lord is my shepherd 2 He maketh
 * me" is a numbered list read aloud. Consecutive verses join into flowing
 * prose. The citation is NOT included here; see formatCitation.
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

  return sorted.map((v) => v.text.trim()).join(" ");
}

/**
 * The citation for a selection, e.g. "Psalms 23:1-4 (KJV)".
 *
 * Kept separate from the verse text on purpose (0023_scripture_reference).
 * When it was appended to the body, the narrator read it out — "...I shall
 * not want, em-dash Psalms twenty-three one to four, K J V" — which is not
 * how anyone says a verse aloud. It now travels alongside the text and is
 * drawn along the bottom of the video instead.
 */
export function formatCitation(
  verses: BibleVerse[],
  translation: BibleTranslation
): string {
  if (verses.length === 0) return "";
  const sorted = [...verses].sort(
    (a, b) =>
      a.book_order - b.book_order || a.chapter - b.chapter || a.verse - b.verse
  );
  return `${formatReference(sorted)} (${translation})`;
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

/**
 * Common ways people write book names. Keys are lowercase, punctuation
 * stripped; values are the canonical name in BIBLE_BOOKS.
 *
 * Written out rather than derived from prefixes because prefix matching gets
 * these wrong in ways that matter: "Ph" is ambiguous between Philippians and
 * Philemon, "Jud" between Judges and Jude, and "Jo" between Job, Joel, John,
 * Jonah and Joshua. A person typing "jn 3:16" means John, and only a real
 * alias table knows that.
 */
const REFERENCE_ALIASES: Record<string, string> = {
  gen: "Genesis", ge: "Genesis", gn: "Genesis",
  ex: "Exodus", exo: "Exodus", exod: "Exodus",
  lev: "Leviticus", lv: "Leviticus",
  num: "Numbers", nm: "Numbers", nu: "Numbers",
  deut: "Deuteronomy", dt: "Deuteronomy", deu: "Deuteronomy",
  josh: "Joshua", jos: "Joshua",
  judg: "Judges", jdg: "Judges",
  rut: "Ruth", ru: "Ruth",
  "1sam": "1 Samuel", "1sa": "1 Samuel", "1s": "1 Samuel",
  "2sam": "2 Samuel", "2sa": "2 Samuel", "2s": "2 Samuel",
  "1kgs": "1 Kings", "1ki": "1 Kings", "1kin": "1 Kings",
  "2kgs": "2 Kings", "2ki": "2 Kings", "2kin": "2 Kings",
  "1chr": "1 Chronicles", "1ch": "1 Chronicles",
  "2chr": "2 Chronicles", "2ch": "2 Chronicles",
  ezr: "Ezra", neh: "Nehemiah", est: "Esther", esth: "Esther",
  jb: "Job",
  ps: "Psalms", psa: "Psalms", psalm: "Psalms", pss: "Psalms",
  prov: "Proverbs", prv: "Proverbs", pr: "Proverbs",
  eccl: "Ecclesiastes", ecc: "Ecclesiastes", eccles: "Ecclesiastes",
  song: "Song of Solomon", sos: "Song of Solomon",
  "songofsongs": "Song of Solomon", cant: "Song of Solomon",
  isa: "Isaiah", is: "Isaiah",
  jer: "Jeremiah", lam: "Lamentations",
  ezek: "Ezekiel", eze: "Ezekiel", ezk: "Ezekiel",
  dan: "Daniel", dn: "Daniel",
  hos: "Hosea", jl: "Joel", am: "Amos", ob: "Obadiah", obad: "Obadiah",
  jon: "Jonah", jnh: "Jonah", mic: "Micah", nah: "Nahum", na: "Nahum",
  hab: "Habakkuk", zeph: "Zephaniah", zep: "Zephaniah",
  hag: "Haggai", zech: "Zechariah", zec: "Zechariah",
  mal: "Malachi",
  matt: "Matthew", mt: "Matthew", mat: "Matthew",
  mk: "Mark", mar: "Mark", mrk: "Mark",
  lk: "Luke", luk: "Luke",
  jn: "John", joh: "John", jhn: "John",
  act: "Acts", ac: "Acts",
  rom: "Romans", rm: "Romans", ro: "Romans",
  "1cor": "1 Corinthians", "1co": "1 Corinthians",
  "2cor": "2 Corinthians", "2co": "2 Corinthians",
  gal: "Galatians", ga: "Galatians",
  eph: "Ephesians", ephes: "Ephesians",
  phil: "Philippians", php: "Philippians", "philip": "Philippians",
  col: "Colossians",
  "1thess": "1 Thessalonians", "1th": "1 Thessalonians", "1thes": "1 Thessalonians",
  "2thess": "2 Thessalonians", "2th": "2 Thessalonians", "2thes": "2 Thessalonians",
  "1tim": "1 Timothy", "1ti": "1 Timothy",
  "2tim": "2 Timothy", "2ti": "2 Timothy",
  tit: "Titus", ti: "Titus",
  phlm: "Philemon", phm: "Philemon", "philem": "Philemon",
  heb: "Hebrews", hb: "Hebrews",
  jas: "James", jm: "James",
  "1pet": "1 Peter", "1pe": "1 Peter", "1pt": "1 Peter",
  "2pet": "2 Peter", "2pe": "2 Peter", "2pt": "2 Peter",
  "1jn": "1 John", "1jo": "1 John", "1joh": "1 John",
  "2jn": "2 John", "2jo": "2 John", "2joh": "2 John",
  "3jn": "3 John", "3jo": "3 John", "3joh": "3 John",
  jud: "Jude", jde: "Jude",
  rev: "Revelation", rv: "Revelation", "apocalypse": "Revelation",
};

export interface BibleReference {
  book: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
}

/**
 * Parses a scripture reference typed by a person.
 *
 * Handles the shapes people actually type: "John 3:16", "john 3", "Ps 23",
 * "Psalm 23:1-6", "1 Cor 13:4-7", "Genesis 1.1", "Rev 22 21". Leading book
 * numbers may be written as digits or as "first"/"1st".
 *
 * Returns null for anything that isn't a reference, which is the signal to
 * fall through to keyword search — "the lord is my shepherd" must not be
 * mangled into a reference, and neither must a bare number.
 */
export function parseReference(input: string): BibleReference | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  // Book part = everything up to the first digit that starts the chapter.
  // The leading ordinal (1/2/3 John) is allowed to stay with the book.
  const match = raw.match(
    /^\s*((?:[1-3]\s*(?:st|nd|rd)?\s*)?[a-z][a-z\s.]*?)\s*(\d+)\s*(?:[:.\s]\s*(\d+)\s*(?:\s*[-–—]\s*(\d+))?)?\s*$/i
  );
  if (!match) return null;

  const [, bookRaw, chapterRaw, verseRaw, verseEndRaw] = match;

  // Normalize "1st John" / "I John" / "1 jn" down to "1jn".
  let key = bookRaw
    .toLowerCase()
    .replace(/[.\s]/g, "")
    .replace(/^(1|2|3)(st|nd|rd)/, "$1");

  // Full canonical names first, then the alias table.
  const canonical =
    BIBLE_BOOKS.find((b) => b.toLowerCase().replace(/\s/g, "") === key) ??
    REFERENCE_ALIASES[key] ??
    null;
  if (!canonical) return null;

  const chapter = Number(chapterRaw);
  if (!Number.isInteger(chapter) || chapter < 1) return null;

  const verseStart = verseRaw ? Number(verseRaw) : null;
  const verseEnd = verseEndRaw ? Number(verseEndRaw) : verseStart;
  if (verseStart !== null && (verseStart < 1 || (verseEnd ?? 0) < verseStart)) {
    return null;
  }

  return { book: canonical, chapter, verseStart, verseEnd };
}


/**
 * Where the Old Testament ends and the New begins.
 *
 * Books 1-39 are the Old Testament, 40-66 (Matthew onwards) the New. This
 * is the Protestant canon, matching what is seeded — other traditions
 * include additional books, which is a data question rather than a display
 * one and would be handled by seeding them.
 */
export const OLD_TESTAMENT_BOOK_COUNT = 39;

export function testamentOf(bookOrder: number): "Old Testament" | "New Testament" {
  return bookOrder <= OLD_TESTAMENT_BOOK_COUNT ? "Old Testament" : "New Testament";
}

export const OLD_TESTAMENT_BOOKS = BIBLE_BOOKS.slice(0, OLD_TESTAMENT_BOOK_COUNT);
export const NEW_TESTAMENT_BOOKS = BIBLE_BOOKS.slice(OLD_TESTAMENT_BOOK_COUNT);

/** A mark a reader has put on a verse. */
export type MarkStyle = "highlight" | "bold" | "underline" | "bookmark";

export const MARK_STYLES: { id: MarkStyle; label: string; icon: string }[] = [
  { id: "highlight", label: "Highlight", icon: "🖍️" },
  { id: "bold", label: "Bold", icon: "𝗕" },
  { id: "underline", label: "Underline", icon: "U̲" },
  { id: "bookmark", label: "Bookmark", icon: "🔖" },
];

/** Key used to look a verse's marks up client-side. */
export function verseKey(book: string, chapter: number, verse: number): string {
  return `${book}|${chapter}|${verse}`;
}

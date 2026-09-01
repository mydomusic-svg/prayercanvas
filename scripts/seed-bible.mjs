// Loads the King James Version and the World English Bible into
// public.bible_verses (see 0021_bible.sql). Both are public domain.
//
// Run from the repo root:
//
//   node --env-file=.env.local scripts/seed-bible.mjs            # both
//   node --env-file=.env.local scripts/seed-bible.mjs KJV        # one
//   node --env-file=.env.local scripts/seed-bible.mjs --file kjv.json KJV
//
// WHY THIS SCRIPT VALIDATES INSTEAD OF TRUSTING A URL.
//
// Public-domain Bible JSON is mirrored in dozens of places, and those
// mirrors move, rename files and change shape. Rather than hardcode one URL
// and hope, this tries a list of known sources in order, normalizes
// whatever shape comes back, and then CHECKS the result against facts about
// the Bible that any correct copy must satisfy: 66 books, ~31,100 verses,
// Genesis 1:1 and Revelation 22:21 present and reading the way they should.
// A source that fails any of that is rejected and the next is tried. If
// they all fail, the script says so and tells you how to supply the file
// yourself, rather than half-filling the table.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Canonical Protestant order. This is the authority for book_order and for
// the spelling stored in `book` — sources disagree on "Psalms" vs "Psalm",
// "Song of Solomon" vs "Song of Songs", and on how they abbreviate, so
// every incoming book name is matched against this list and stored in this
// spelling. That keeps the UI's book list and the data in step.
const BOOKS = [
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

// Spellings and abbreviations seen across the sources below, mapped onto the
// canonical names above.
const ALIASES = {
  "song of songs": "Song of Solomon",
  "canticles": "Song of Solomon",
  "psalm": "Psalms",
  "ecclesiasties": "Ecclesiastes",
  "revelation of john": "Revelation",
  "the revelation": "Revelation",
  "acts of the apostles": "Acts",
  "i samuel": "1 Samuel", "ii samuel": "2 Samuel",
  "i kings": "1 Kings", "ii kings": "2 Kings",
  "i chronicles": "1 Chronicles", "ii chronicles": "2 Chronicles",
  "i corinthians": "1 Corinthians", "ii corinthians": "2 Corinthians",
  "i thessalonians": "1 Thessalonians", "ii thessalonians": "2 Thessalonians",
  "i timothy": "1 Timothy", "ii timothy": "2 Timothy",
  "i peter": "1 Peter", "ii peter": "2 Peter",
  "i john": "1 John", "ii john": "2 John", "iii john": "3 John",
};

const BOOK_INDEX = new Map(BOOKS.map((b, i) => [b.toLowerCase(), i + 1]));

function bookOrder(rawName) {
  if (rawName == null) return null;
  let name = String(rawName).trim().toLowerCase();
  name = name.replace(/^([123])\s*(st|nd|rd)?\s+/, "$1 ");
  if (ALIASES[name]) name = ALIASES[name].toLowerCase();
  return BOOK_INDEX.get(name) ?? null;
}

// Candidate sources, tried in order. Each entry says how to turn its own
// JSON shape into flat {book_order, book, chapter, verse, text} rows.
const SOURCES = {
  KJV: [
    {
      label: "getbible v2",
      url: "https://api.getbible.net/v2/kjv.json",
      parse: parseGetBible,
    },
    {
      label: "scrollmapper",
      url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json",
      parse: parseScrollmapper,
    },
    {
      label: "jadenzaleski/bible-translations",
      url: "https://raw.githubusercontent.com/jadenzaleski/BibleTranslations/master/KJV/KJV_bible.json",
      parse: parseNestedObject,
    },
  ],
  WEB: [
    {
      label: "getbible v2",
      url: "https://api.getbible.net/v2/web.json",
      parse: parseGetBible,
    },
    {
      label: "scrollmapper",
      url: "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/WEB.json",
      parse: parseScrollmapper,
    },
    {
      label: "jadenzaleski/bible-translations",
      url: "https://raw.githubusercontent.com/jadenzaleski/BibleTranslations/master/WEB/WEB_bible.json",
      parse: parseNestedObject,
    },
  ],
};

// { books: [ { nr, name, chapters: [ { chapter, verses: [ { verse, text } ] } ] } ] }
function parseGetBible(data) {
  const rows = [];
  const books = data?.books ?? [];
  for (const book of books) {
    const order = bookOrder(book.name) ?? (Number(book.nr) || null);
    if (!order) continue;
    for (const chapter of book.chapters ?? []) {
      for (const v of chapter.verses ?? []) {
        rows.push({
          book_order: order,
          book: BOOKS[order - 1],
          chapter: Number(chapter.chapter),
          verse: Number(v.verse),
          text: String(v.text ?? "").trim(),
        });
      }
    }
  }
  return rows;
}

// Flat: { resultset: { row: [ { field: [id, book_id, chapter, verse, text] } ] } }
// or a plain array of { book_name, chapter, verse, text }.
function parseScrollmapper(data) {
  const rows = [];
  const flat = Array.isArray(data) ? data : data?.resultset?.row ?? [];
  for (const entry of flat) {
    if (Array.isArray(entry?.field)) {
      const [, bookId, chapter, verse, text] = entry.field;
      const order = Number(bookId);
      if (!order || order < 1 || order > 66) continue;
      rows.push({
        book_order: order,
        book: BOOKS[order - 1],
        chapter: Number(chapter),
        verse: Number(verse),
        text: String(text ?? "").trim(),
      });
    } else if (entry?.book_name || entry?.book) {
      const order = bookOrder(entry.book_name ?? entry.book);
      if (!order) continue;
      rows.push({
        book_order: order,
        book: BOOKS[order - 1],
        chapter: Number(entry.chapter),
        verse: Number(entry.verse),
        text: String(entry.text ?? "").trim(),
      });
    }
  }
  return rows;
}

// { "Genesis": { "1": { "1": "In the beginning..." } } }
function parseNestedObject(data) {
  const rows = [];
  for (const [bookName, chapters] of Object.entries(data ?? {})) {
    const order = bookOrder(bookName);
    if (!order || typeof chapters !== "object") continue;
    for (const [chapter, verses] of Object.entries(chapters)) {
      if (typeof verses !== "object") continue;
      for (const [verse, text] of Object.entries(verses)) {
        rows.push({
          book_order: order,
          book: BOOKS[order - 1],
          chapter: Number(chapter),
          verse: Number(verse),
          text: String(text ?? "").trim(),
        });
      }
    }
  }
  return rows;
}

// Facts any correct copy of the Bible must satisfy. Verse totals differ
// slightly between translations (the WEB and the KJV do not always split
// verses identically), so the count is a range rather than an exact number —
// but a truncated or wrongly-parsed download misses it by thousands.
function validate(rows, translation) {
  const problems = [];
  if (rows.length < 30000 || rows.length > 32000) {
    problems.push(`expected ~31,100 verses, got ${rows.length.toLocaleString()}`);
  }
  const books = new Set(rows.map((r) => r.book_order));
  if (books.size !== 66) problems.push(`expected 66 books, got ${books.size}`);

  const find = (o, c, v) =>
    rows.find((r) => r.book_order === o && r.chapter === c && r.verse === v);

  const gen = find(1, 1, 1);
  if (!gen) problems.push("Genesis 1:1 missing");
  else if (!/^in the beginning/i.test(gen.text)) {
    problems.push(`Genesis 1:1 reads unexpectedly: "${gen.text.slice(0, 60)}"`);
  }

  const rev = find(66, 22, 21);
  if (!rev) problems.push("Revelation 22:21 missing");

  const psalm23 = find(19, 23, 1);
  if (!psalm23) problems.push("Psalm 23:1 missing");
  else if (!/shepherd/i.test(psalm23.text)) {
    problems.push(`Psalm 23:1 reads unexpectedly: "${psalm23.text.slice(0, 60)}"`);
  }

  const empty = rows.filter((r) => !r.text).length;
  if (empty > 0) problems.push(`${empty} verse(s) have empty text`);

  const bad = rows.filter(
    (r) => !Number.isInteger(r.chapter) || !Number.isInteger(r.verse)
  ).length;
  if (bad > 0) problems.push(`${bad} row(s) have a non-numeric chapter/verse`);

  return problems;
}

async function loadTranslation(translation, localFile) {
  if (localFile) {
    const raw = JSON.parse(await readFile(localFile, "utf8"));
    for (const parse of [parseGetBible, parseScrollmapper, parseNestedObject]) {
      const rows = parse(raw);
      if (rows.length > 1000) {
        const problems = validate(rows, translation);
        if (problems.length === 0) {
          console.log(`  ${localFile}: ${rows.length.toLocaleString()} verses — validated.`);
          return rows;
        }
        console.log(`  ${localFile} parsed but failed validation: ${problems.join("; ")}`);
      }
    }
    throw new Error(`Could not parse ${localFile} into a valid Bible.`);
  }

  for (const source of SOURCES[translation]) {
    try {
      process.stdout.write(`  trying ${source.label}... `);
      const res = await fetch(source.url, { redirect: "follow" });
      if (!res.ok) {
        console.log(`HTTP ${res.status}`);
        continue;
      }
      const rows = source.parse(await res.json());
      const problems = validate(rows, translation);
      if (problems.length > 0) {
        console.log(`rejected (${problems.join("; ")})`);
        continue;
      }
      console.log(`OK — ${rows.length.toLocaleString()} verses, validated.`);
      return rows;
    } catch (err) {
      console.log(`failed (${err.message})`);
    }
  }
  throw new Error(
    `No working source for ${translation}.\n` +
      `Download a public-domain ${translation} JSON yourself and pass it:\n` +
      `  node --env-file=.env.local scripts/seed-bible.mjs --file <path.json> ${translation}`
  );
}

async function insertRows(translation, rows) {
  // Clear first so a re-run replaces rather than collides with the unique
  // constraint, and so switching sources cannot leave a mix of two.
  const { error: delError } = await supabase
    .from("bible_verses")
    .delete()
    .eq("translation", translation);
  if (delError) throw new Error(`clear failed: ${delError.message}`);

  const BATCH = 1000;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, translation }));
    const { error } = await supabase.from("bible_verses").insert(batch);
    if (error) throw new Error(`insert failed at row ${i}: ${error.message}`);
    written += batch.length;
    process.stdout.write(`\r  writing... ${written.toLocaleString()}/${rows.length.toLocaleString()}`);
  }
  process.stdout.write("\n");
  return written;
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  const localFile = fileIdx >= 0 ? args[fileIdx + 1] : null;
  const named = args.filter(
    (a) => !a.startsWith("--") && a !== localFile
  ).map((a) => a.toUpperCase());
  const translations = named.length > 0 ? named : ["KJV", "WEB"];

  for (const t of translations) {
    if (!SOURCES[t]) {
      console.error(`Unknown translation "${t}". Only KJV and WEB are public domain.`);
      process.exitCode = 1;
      continue;
    }
    console.log(`\n${t}:`);
    try {
      const rows = await loadTranslation(t, localFile);
      const written = await insertRows(t, rows);
      console.log(`  ${written.toLocaleString()} verses in place.`);
    } catch (err) {
      console.error(`  ${err.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Bible seed failed:", err);
  process.exit(1);
});

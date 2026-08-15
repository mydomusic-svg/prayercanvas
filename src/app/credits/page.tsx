import HeroBanner from "../hero-banner";

export const metadata = { title: "Credits — PrayerMessenger" };

const VIDEO_CREDITS = [
  { style: "Nature", title: "Forest stream", source: "Pexels" },
  { style: "Cinematic", title: "Storm clouds with light rays", source: "Pexels" },
  { style: "Minimal", title: "Gold bokeh lights", source: "Pexels" },
  { style: "Celebration", title: "Morning sunshine through foliage", source: "Pexels" },
  { style: "Scripture", title: "Lit candle", source: "Pexels" },
  { style: "Peaceful", title: "Sunset clouds", source: "Pexels" },
];

const MUSIC_CREDITS = [
  { style: "Nature", title: "Windswept" },
  { style: "Cinematic", title: "Majestic Hills" },
  { style: "Minimal", title: "Pensif" },
  { style: "Celebration", title: "Carefree" },
  { style: "Scripture", title: "Amazing Grace 2011" },
  { style: "Peaceful", title: "Winter Reflections" },
  { style: "Piano", title: "Meditation Impromptu 01" },
  { style: "Ukulele", title: "Local Forecast" },
  { style: "Ambient", title: "Wallpaper" },
  { style: "Classical", title: "Canon in D Pachelbel" },
];

export default function CreditsPage() {
  return (
    <>
      <HeroBanner variant="slim" />
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Credits</h1>
        <p className="mt-2 text-sm text-sage-500">
          PrayerMessenger background videos and music are licensed from the
          following sources.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-sage-800">
          Background video — Pexels
        </h2>
        <p className="text-xs text-sage-500">
          Used under the{" "}
          <a
            href="https://www.pexels.com/license/"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Pexels License
          </a>{" "}
          (free for commercial use, no attribution required).
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-sage-600">
          {VIDEO_CREDITS.map((c) => (
            <li key={c.style}>
              <span className="font-medium">{c.style}:</span> {c.title} ({c.source})
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-sage-800">
          Music — Kevin MacLeod (incompetech.com)
        </h2>
        <p className="text-xs text-sage-500">
          Licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Creative Commons Attribution 4.0
          </a>
          .
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-sm text-sage-600">
          {MUSIC_CREDITS.map((c) => (
            <li key={c.style}>
              <span className="font-medium">{c.style}:</span> &quot;{c.title}&quot; by
              Kevin MacLeod (incompetech.com), licensed under CC BY 4.0.
            </li>
          ))}
        </ul>
      </section>
      </main>
    </>
  );
}

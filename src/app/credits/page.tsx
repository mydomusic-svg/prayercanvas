import { createClient } from "@/lib/supabase/server";
import HeroBanner from "../hero-banner";

export const metadata = { title: "Credits — PrayerMessenger" };

// Video/music credits are read directly from the database (styles.source/
// license, music_styles.source/license — see
// supabase/migrations/0011_asset_library.sql) so this page stays accurate
// automatically as the asset library grows, instead of a hand-maintained
// list that drifts out of sync.

function groupBySourceLicense<T extends { source: string | null; license: string | null }>(
  rows: T[]
) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.source || "Unknown source"}|||${row.license || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return Array.from(groups.entries()).map(([key, items]) => {
    const [source, license] = key.split("|||");
    return { source, license, items };
  });
}

export default async function CreditsPage() {
  const supabase = await createClient();

  const [{ data: styles }, { data: musicStyles }] = await Promise.all([
    supabase
      .from("styles")
      .select("name, category, source, license")
      .order("category", { ascending: true }),
    supabase
      .from("music_styles")
      .select("name, category, source, license")
      .order("category", { ascending: true }),
  ]);

  const videoGroups = groupBySourceLicense(styles || []);
  const musicGroups = groupBySourceLicense(musicStyles || []);

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

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-medium text-sage-800">Background video</h2>
        {videoGroups.map((group) => (
          <div key={`${group.source}-${group.license}`} className="flex flex-col gap-2">
            <p className="text-xs text-sage-500">
              <span className="font-medium">{group.source}</span>
              {group.license ? ` — ${group.license}` : ""}
            </p>
            <ul className="flex flex-col gap-1 text-sm text-sage-600">
              {group.items.map((item, i) => (
                <li key={`${item.name}-${i}`}>
                  {item.category && item.category !== item.name ? (
                    <span className="font-medium">{item.category}:</span>
                  ) : null}{" "}
                  {item.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-medium text-sage-800">Music</h2>
        {musicGroups.map((group) => (
          <div key={`${group.source}-${group.license}`} className="flex flex-col gap-2">
            <p className="text-xs text-sage-500">
              <span className="font-medium">{group.source}</span>
              {group.license ? ` — ${group.license}` : ""}
            </p>
            <ul className="flex flex-col gap-1 text-sm text-sage-600">
              {group.items.map((item, i) => (
                <li key={`${item.name}-${i}`}>
                  &quot;{item.name}&quot;
                  {item.category && item.category !== item.name
                    ? ` (${item.category})`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      </main>
    </>
  );
}

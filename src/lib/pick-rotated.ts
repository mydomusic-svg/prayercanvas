/**
 * Choose an item from a pool, avoiding what this person has had recently.
 *
 * WHY THIS EXISTS AS A SHARED FUNCTION. A rotation algorithm already lived
 * in the process route — cooldown, prefer-unused, then least-recently-used
 * — and it was good. It just only ran on ONE of the four paths that pick
 * something:
 *
 *   music, Auto            ->  rotated properly
 *   music, category chosen ->  bare Math.random() on the create page
 *   visuals, Auto          ->  bare Math.random() in pickFrom
 *   visuals, category      ->  bare Math.random() on the create page
 *
 * So three prayers in a row could easily land the same track and the same
 * background, which is exactly what got reported. Someone who makes a few
 * prayers and gets the same bed each time reads that as the app being
 * broken, not as chance — and they are not wrong to, because with the
 * handful of items a narrow category holds, uniform random repeats far more
 * often than people expect. Eight clips and four prayers is better than even
 * odds of a repeat; that is the birthday problem, not bad luck.
 *
 * One implementation, used by every path.
 */

export type Rotatable = { id: string; category: string | null };

/** Last-used timestamp per id, newest-first rows in, map out. */
export function lastUsedMap(
  rows: Array<{ id: string | null; created_at: string }>
): Map<string, number> {
  const lastUsed = new Map<string, number>();
  for (const row of rows) {
    // Rows arrive newest-first, so the first sighting of an id is its most
    // recent use and any later sighting is older. Skipping duplicates keeps
    // the newest.
    if (!row.id || lastUsed.has(row.id)) continue;
    lastUsed.set(row.id, new Date(row.created_at).getTime());
  }
  return lastUsed;
}

export const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

export function pickRotated<T extends Rotatable>(
  rows: T[],
  category: string | null,
  lastUsed: Map<string, number>,
  cooldownMs: number = DEFAULT_COOLDOWN_MS
): string | null {
  if (rows.length === 0) return null;

  const pool = category
    ? rows.filter((r) => (r.category || "Other") === category)
    : rows;
  // Falling back to the whole library rather than returning null keeps a
  // prayer from ending up with no background or no music at all just
  // because its category happens to be empty.
  const options = pool.length > 0 ? pool : rows;

  const cutoff = Date.now() - cooldownMs;
  let eligible = options.filter((r) => (lastUsed.get(r.id) ?? 0) < cutoff);
  // If the cooldown rules out everything — a category smaller than the
  // number of prayers someone just made — a repeat is far better than
  // nothing, so fall back rather than returning null.
  if (eligible.length === 0) eligible = options;

  // Anything never used gets first refusal, at random among itself. This is
  // what makes someone work through a whole category before seeing any of
  // it twice, instead of random walking over the same three favourites.
  const unused = eligible.filter((r) => !lastUsed.has(r.id));
  if (unused.length > 0) {
    return unused[Math.floor(Math.random() * unused.length)].id;
  }

  // Everything has been used: take whichever was used longest ago.
  return eligible.reduce((oldest, r) =>
    (lastUsed.get(r.id) ?? 0) < (lastUsed.get(oldest.id) ?? 0) ? r : oldest
  ).id;
}

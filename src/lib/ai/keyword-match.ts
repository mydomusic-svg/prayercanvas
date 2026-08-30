/**
 * Deterministic keyword fallback for picking a prayer's music and background
 * category from its transcript.
 *
 * The PRIMARY matcher is Claude (see analyzePrayer) — it already reads every
 * transcript to detect theme and title, so asking it for two more fields is
 * effectively free, and it understands intent that keywords cannot: "watch
 * over my son on his drive tonight" is plainly a protection prayer without
 * containing the word "protection".
 *
 * This exists for when that call fails or returns a category that isn't in
 * the live library — a missing API key, a rate limit, a renamed category.
 * Rather than dropping back to "whatever is first in the list", it makes a
 * reasonable guess from the words actually said.
 *
 * Scoring, rather than first-match: a prayer that says "heal" once but
 * "thank you" five times is a gratitude prayer. Each hit adds its rule's
 * weight, and the highest-scoring category wins. Weights let a strong signal
 * ("funeral") outrank several weak ones.
 */

interface Rule {
  /** Matched case-insensitively against word boundaries. */
  words: string[];
  weight: number;
  /** Preferred music categories, best first. */
  music: string[];
  /** Preferred background/style categories, best first. */
  visual: string[];
}

const RULES: Rule[] = [
  {
    words: [
      "protect", "protection", "protecting", "safety", "safe", "keep him safe",
      "keep her safe", "watch over", "guard", "shield", "angel", "angels",
      "guardian", "travel", "traveling", "journey", "shelter", "refuge",
    ],
    weight: 3,
    music: ["Scripture", "Ambient", "Peaceful"],
    visual: ["Scripture", "Hope", "Peaceful"],
  },
  {
    words: [
      "mercy", "merciful", "forgive", "forgiveness", "grace", "repent",
      "sin", "sorry", "confess", "redeem", "redemption",
    ],
    weight: 3,
    music: ["Scripture", "Classical", "Peaceful"],
    visual: ["Scripture", "Minimal", "Peaceful"],
  },
  {
    words: [
      "heal", "healing", "healed", "sick", "illness", "hospital", "surgery",
      "recover", "recovery", "pain", "cancer", "diagnosis", "strength",
      "doctor", "treatment",
    ],
    weight: 3,
    music: ["Peaceful", "Piano", "Calm"],
    visual: ["Peaceful", "Nature", "Hope"],
  },
  {
    words: [
      "grief", "grieving", "loss", "lost", "passed away", "died", "death",
      "funeral", "mourning", "miss him", "miss her", "memory", "comfort",
    ],
    weight: 4,
    music: ["Classical", "Piano", "Peaceful"],
    visual: ["Minimal", "Peaceful", "Nature"],
  },
  {
    words: [
      "celebrate", "celebration", "congratulations", "birthday", "wedding",
      "anniversary", "graduation", "graduate", "promotion", "engaged",
      "new job", "baby", "newborn", "party",
    ],
    weight: 4,
    music: ["Celebration", "Uplifting"],
    visual: ["Celebration", "Family", "Hope"],
  },
  {
    words: [
      "thank", "thanks", "thankful", "grateful", "gratitude", "blessed",
      "blessing", "praise", "hallelujah", "glory",
    ],
    weight: 2,
    music: ["Uplifting", "Celebration", "Classical"],
    visual: ["Hope", "Nature", "Celebration"],
  },
  {
    words: [
      "peace", "peaceful", "calm", "rest", "quiet", "still", "stillness",
      "anxious", "anxiety", "worry", "worried", "fear", "afraid", "sleep",
    ],
    weight: 2,
    music: ["Calm", "Meditation", "Ambient"],
    visual: ["Peaceful", "Nature", "Minimal"],
  },
  {
    words: [
      "family", "mother", "father", "mom", "dad", "son", "daughter",
      "children", "kids", "husband", "wife", "grandma", "grandpa", "sister",
      "brother", "home",
    ],
    weight: 2,
    music: ["Uplifting", "Peaceful", "Piano"],
    visual: ["Family", "Hope", "Peaceful"],
  },
  {
    words: [
      "hope", "hopeful", "future", "dream", "new beginning", "fresh start",
      "beginning", "guidance", "guide", "path", "direction", "purpose",
      "encourage", "courage", "strength",
    ],
    weight: 2,
    music: ["Uplifting", "Cinematic", "Ambient"],
    visual: ["Hope", "Cinematic", "Nature"],
  },
];

function countHits(haystack: string, words: string[]): number {
  let hits = 0;
  for (const w of words) {
    // Escape regex metacharacters, then match on word boundaries so "sin"
    // doesn't fire on "sincerely" and "safe" doesn't fire on "safety net"
    // twice via two different rules.
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    hits += (haystack.match(re) ?? []).length;
  }
  return hits;
}

/**
 * Picks the best-scoring music and visual category for a transcript,
 * restricted to categories that actually exist in the library.
 *
 * Returns nulls when nothing matches, which the caller should treat as
 * "leave it to the existing random pick" rather than forcing a bad guess.
 */
export function matchCategoriesByKeyword(
  transcript: string,
  availableMusic: string[],
  availableVisual: string[]
): { musicCategory: string | null; visualCategory: string | null } {
  const text = (transcript || "").toLowerCase();
  if (!text.trim()) return { musicCategory: null, visualCategory: null };

  const musicScores = new Map<string, number>();
  const visualScores = new Map<string, number>();

  for (const rule of RULES) {
    const hits = countHits(text, rule.words);
    if (hits === 0) continue;
    const score = hits * rule.weight;

    // Preference order matters: the rule's first choice gets the full score,
    // later ones a decaying share, so a category that is several rules'
    // second choice can still lose to one rule's strong first choice.
    rule.music.forEach((cat, i) => {
      musicScores.set(cat, (musicScores.get(cat) ?? 0) + score / (i + 1));
    });
    rule.visual.forEach((cat, i) => {
      visualScores.set(cat, (visualScores.get(cat) ?? 0) + score / (i + 1));
    });
  }

  const best = (scores: Map<string, number>, available: string[]) => {
    const allowed = new Set(available);
    let winner: string | null = null;
    let top = 0;
    for (const [cat, score] of scores) {
      if (!allowed.has(cat)) continue;
      if (score > top) {
        top = score;
        winner = cat;
      }
    }
    return winner;
  };

  return {
    musicCategory: best(musicScores, availableMusic),
    visualCategory: best(visualScores, availableVisual),
  };
}

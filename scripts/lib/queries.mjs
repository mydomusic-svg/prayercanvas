// The search terms every background seeder uses, in one place.
//
// Coverr, Pexels and Pixabay index different contributors, so the same
// phrase returns largely different footage from each. Keeping one list and
// pointing all three at it means a term added here widens the library
// across every source at once, instead of drifting out of step in three
// separate files.
//
// CATEGORY MATTERS MORE THAN IT LOOKS. The create page picks a category and
// then a RANDOM clip within it, so a category is really "the bag of clips
// this choice draws from". Roses filed under Nature means someone choosing
// Nature usually gets a waterfall — which is why Flowers is its own bag.

export const BACKGROUND_QUERIES = {
  Flowers: [
    "cinematic flowers",
    "rose closeup",
    "flower bloom",
    "flowers wind",
    "roses",
    "rose petals falling",
    "cherry blossom",
    "sunflower field",
    "lavender field",
    "tulips",
    "wildflowers meadow",
  ],
  Nature: [
    "waterfall slow motion",
    "nature 4K",
    "tropical waterfall",
    "waterfall rainforest",
    "forest stream",
    "cascade rocks",
    "sunlight through trees",
    "autumn leaves falling",
    "rain on leaves",
  ],
  Peaceful: [
    "peaceful ocean",
    "garden sunrise",
    "calm lake sunrise",
    "misty forest",
    "gentle river",
    "sunset over water",
    "clouds time lapse",
  ],
  Hope: [
    "heaven",
    "clouds sunlight",
    "sunrise horizon",
    "light breaking through clouds",
    "sunbeams clouds",
    "dove flying",
  ],
  Cinematic: [
    "aerial coastline",
    "northern lights",
    "starry sky time lapse",
    "golden hour field",
    "fog mountains",
  ],
};

/** Flattened [category, query] pairs, in declaration order. */
export function queryPairs(only = null) {
  const entries = Object.entries(BACKGROUND_QUERIES).filter(
    ([category]) => !only || only.includes(category)
  );
  const pairs = [];
  for (const [category, queries] of entries) {
    for (const query of queries) pairs.push([category, query]);
  }
  return pairs;
}

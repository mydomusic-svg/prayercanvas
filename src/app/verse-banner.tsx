/**
 * The banner behind "Today's verse".
 *
 * DRAWN, NOT STORED. An image per passage would mean 101 files in a bucket
 * this project is already over quota on, plus a network request on every
 * dashboard load, to decorate a card. These are a few hundred bytes of
 * inline SVG: nothing to upload, nothing to fetch, sharp at any size, and
 * they recolour themselves for dark mode for free.
 *
 * The scene follows the passage's own `theme` column, which the pool was
 * seeded with — so a verse about protection gets sheltering wings and a
 * verse about hope gets a sunrise, without anyone hand-assigning artwork.
 */
type Scene = "dawn" | "water" | "night" | "peaks" | "shelter" | "field";

const THEME_SCENES: Record<string, Scene> = {
  hope: "dawn", renewal: "dawn", gratitude: "dawn", praise: "dawn",
  blessing: "dawn", seasons: "dawn", grace: "dawn",
  peace: "water", rest: "water", comfort: "water", trust: "water",
  faith: "night", prayer: "night", longing: "night", wonder: "night",
  guidance: "night",
  strength: "peaks", perseverance: "peaks", courage: "peaks",
  protection: "shelter", love: "shelter", healing: "shelter",
  purpose: "field", work: "field", identity: "field", wisdom: "field",
  character: "field", forgiveness: "field", unity: "field", kindness: "field",
};

const PALETTES: Record<Scene, { sky: [string, string, string]; near: string; far: string }> = {
  dawn:    { sky: ["#FFE6C7", "#F9C784", "#EC9A6D"], far: "#C97B57", near: "#8E4E3C" },
  water:   { sky: ["#DCEDF3", "#9CC5D6", "#5E93AC"], far: "#3C6E88", near: "#264F66" },
  night:   { sky: ["#2A3A62", "#1E2B4C", "#141E38"], far: "#101728", near: "#0A0F1D" },
  peaks:   { sky: ["#F2E4CC", "#DCC29A", "#BE9B70"], far: "#7E6A54", near: "#4E4238" },
  shelter: { sky: ["#F6E9DC", "#E5CDB2", "#CDAA88"], far: "#A87F5C", near: "#7A5A40" },
  field:   { sky: ["#EDF3DE", "#CFDFAE", "#A8C583"], far: "#7C9B58", near: "#55703C" },
};

export default function VerseBanner({ theme }: { theme?: string | null }) {
  const scene: Scene = THEME_SCENES[theme ?? ""] ?? "dawn";
  const p = PALETTES[scene];
  const id = `vb-${scene}`;

  return (
    <svg
      viewBox="0 0 800 220"
      preserveAspectRatio="xMidYMid slice"
      className="h-28 w-full sm:h-36"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.sky[0]} />
          <stop offset="55%" stopColor={p.sky[1]} />
          <stop offset="100%" stopColor={p.sky[2]} />
        </linearGradient>
        {/* The label sits on this banner in white. On the pale skies
            (dawn, peaks, shelter, field) white on cream is unreadable, so
            every scene gets the same soft darkening at the top — one rule
            instead of per-scene label colours that would drift apart. */}
        <linearGradient id={`${id}-scrim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="800" height="220" fill={`url(#${id}-sky)`} />
      <rect width="800" height="96" fill={`url(#${id}-scrim)`} />

      {/* Stars, only where there is a sky dark enough to hold them. */}
      {scene === "night" &&
        [[90, 46, 1.6], [170, 92, 1.1], [265, 38, 1.9], [352, 74, 1.2],
         [455, 44, 1.5], [545, 96, 1.1], [628, 52, 1.8], [712, 86, 1.3]].map(
          ([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="#FFFFFF" opacity={0.75} />
          )
        )}

      {/* The light source: a low sun for dawn/peaks/field, a moon at night,
          nothing over water — there the light is the reflection below. */}
      {scene !== "water" && (
        <>
          <circle cx="600" cy="112" r="120" fill={`url(#${id}-glow)`} />
          <circle
            cx="600"
            cy="112"
            r={scene === "night" ? 26 : 40}
            fill="#FFFFFF"
            opacity={scene === "night" ? 0.9 : 0.82}
          />
        </>
      )}

      {scene === "water" ? (
        <>
          <circle cx="600" cy="80" r="90" fill={`url(#${id}-glow)`} />
          <path d="M0 150 Q 200 132 400 150 T 800 150 V220 H0 Z" fill={p.far} opacity="0.55" />
          <path d="M0 172 Q 210 156 400 172 T 800 172 V220 H0 Z" fill={p.far} />
          <path d="M0 196 Q 190 182 400 196 T 800 196 V220 H0 Z" fill={p.near} />
        </>
      ) : scene === "peaks" ? (
        <>
          <path d="M0 220 L 150 96 L 268 176 L 372 108 L 520 220 Z" fill={p.far} opacity="0.75" />
          <path d="M0 220 L 210 138 L 340 200 L 470 130 L 660 220 Z" fill={p.far} />
          <path d="M0 220 L 250 168 L 430 220 Z" fill={p.near} />
        </>
      ) : scene === "shelter" ? (
        <>
          {/* A sheltering arch over the horizon. This started as two
              wings meeting overhead; rendered, they read as a bow tie
              rather than as wings, so it became one clean span. */}
          <path d="M40 206 Q 400 54 760 206 Q 400 112 40 206 Z" fill={p.far} opacity="0.9" />
          <path d="M140 208 Q 400 104 660 208 Q 400 146 140 208 Z" fill={p.near} opacity="0.7" />
          <path d="M0 220 Q 400 184 800 220 Z" fill={p.near} />
        </>
      ) : (
        <>
          <path d="M0 220 Q 190 150 400 176 T 800 152 V220 Z" fill={p.far} opacity="0.7" />
          <path d="M0 220 Q 240 172 480 198 T 800 186 V220 Z" fill={p.far} />
          <path d="M0 220 Q 280 196 560 214 T 800 206 V220 Z" fill={p.near} />
        </>
      )}
    </svg>
  );
}

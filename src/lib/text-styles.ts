import type { AccentColor, TextStyle } from "@/lib/types";

// Canonical accent color hexes and title fonts — mirrors
// worker/index.js's (now-unused-by-the-worker) ACCENT_COLORS/TEXT_STYLES
// and create/page.tsx's ACCENT_COLOR_OPTIONS/TEXT_STYLE_OPTIONS. Extracted
// here so the video player's title overlay (prayer-video-player.tsx) can
// share the same values without duplicating them a third time — the title
// used to be burned into the rendered video/thumbnail pixels using these,
// but now lives entirely as a dynamic overlay so it can be edited/reshared
// without ever re-rendering.
export const ACCENT_COLOR_HEX: Record<AccentColor, string> = {
  gold: "#f5c451",
  rose: "#e98a9c",
  sky: "#8ecae6",
  sage: "#8fbf8f",
  ivory: "#ffffff",
};

export const TEXT_STYLE_FONT_VAR: Record<
  TextStyle,
  { fontVar: string; uppercase?: boolean }
> = {
  calligraphy: { fontVar: "var(--font-calligraphy)" },
  modern: { fontVar: "var(--font-modern)", uppercase: true },
  handwritten: { fontVar: "var(--font-handwritten)" },
};

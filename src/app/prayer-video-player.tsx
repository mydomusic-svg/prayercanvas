import Image from "next/image";
import type { AccentColor, TextStyle } from "@/lib/types";
import { ACCENT_COLOR_HEX, TEXT_STYLE_FONT_VAR } from "@/lib/text-styles";

// Shared branded video player "skin" — used on both the owner's private
// prayer detail page and the public share page, so a rendered prayer looks
// unmistakably like a PrayerMessenger video wherever it's watched. A plain
// <video> with browser-default controls looked identical to literally any
// other video on the web; recipients had no visual cue this came from the
// app at all (the burned-in "Made with PrayerMessenger" watermark in the
// video's own pixels — see worker/index.js buildFilterComplex — covers the
// video once it's downloaded/reposted elsewhere, but this covers the
// in-app viewing experience itself).
//
// The title is rendered here as a live HTML overlay, NOT burned into the
// video/thumbnail pixels (the worker used to do that — see the note above
// renderPrayer's call site in worker/index.js). A recipient's name baked
// permanently into the video meant a prayer recorded for one person and
// later reused for someone else would always show the first person's name,
// with no fix short of a full re-render. This overlay reads `title` fresh
// on every page load, so editing it (already possible via EditableTitle on
// the owner's page) or resharing with someone new takes effect instantly.
export default function PrayerVideoPlayer({
  src,
  poster,
  title,
  accentColor,
  textStyle,
}: {
  src: string;
  poster?: string | null;
  title?: string | null;
  accentColor?: AccentColor | null;
  textStyle?: TextStyle | null;
}) {
  const color = ACCENT_COLOR_HEX[accentColor ?? "gold"];
  const { fontVar, uppercase } = TEXT_STYLE_FONT_VAR[textStyle ?? "calligraphy"];

  return (
    <div className="w-full">
      {/* Soft gold/sage gradient "frame" around the vertical video, like a
          card mat, instead of the video sitting bare on the page. */}
      <div className="rounded-[28px] bg-gradient-to-b from-amber-300 via-sage-300 to-amber-300 p-[3px] shadow-lg shadow-sage-900/15">
        <div className="relative overflow-hidden rounded-[25px] bg-black">
          <video
            src={src}
            poster={poster ?? undefined}
            controls
            playsInline
            className="block w-full"
          />
          {title ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 px-6 pt-6 text-center text-2xl font-bold leading-tight sm:text-3xl"
              style={{
                color,
                fontFamily: fontVar,
                textTransform: uppercase ? "uppercase" : "none",
                textShadow:
                  "0 1px 3px rgba(0,0,0,0.75), 0 0 10px rgba(0,0,0,0.55)",
                WebkitTextStroke: "0.5px rgba(0,0,0,0.55)",
              }}
            >
              {title}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-1.5">
        <Image
          src="/logo-mark.png"
          alt=""
          width={16}
          height={16}
          className="h-4 w-4 opacity-70"
        />
        <span className="text-xs font-medium tracking-wide text-sage-400">
          Made with PrayerMessenger
        </span>
      </div>
    </div>
  );
}

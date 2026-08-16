import Image from "next/image";

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
// The title used to be rendered here as a live HTML overlay on top of the
// video (kept in sync with edits without re-rendering). That approach was
// reverted — see the note above renderPrayer's title-burning code in
// worker/index.js — because recipients who received the video as a native
// file never saw the HTML overlay at all, only the actual video pixels. Now
// that the title is burned back into the video itself, keeping this HTML
// overlay too would just draw a second, slightly misaligned copy of the
// same text on top of the first every time someone watches in-app — so it's
// gone; `title` is only used for the video's accessible label now.
export default function PrayerVideoPlayer({
  src,
  poster,
  title,
}: {
  src: string;
  poster?: string | null;
  title?: string | null;
}) {
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
            aria-label={title ?? "Prayer video"}
            className="block w-full"
          />
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

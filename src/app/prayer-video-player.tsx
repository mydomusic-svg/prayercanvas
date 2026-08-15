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
export default function PrayerVideoPlayer({
  src,
  poster,
}: {
  src: string;
  poster?: string | null;
}) {
  return (
    <div className="w-full">
      {/* Soft gold/sage gradient "frame" around the vertical video, like a
          card mat, instead of the video sitting bare on the page. */}
      <div className="rounded-[28px] bg-gradient-to-b from-amber-300 via-sage-300 to-amber-300 p-[3px] shadow-lg shadow-sage-900/15">
        <div className="overflow-hidden rounded-[25px] bg-black">
          <video
            src={src}
            poster={poster ?? undefined}
            controls
            playsInline
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

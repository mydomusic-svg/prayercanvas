// Reusable hero banner — original illustrated artwork (soft sage sky, doves,
// gentle light), not a stock photo, since sourcing real photography of
// praying hands/people from the web would carry copyright/licensing risk.
// "full" is the tall homepage treatment with room for a headline; "slim" is
// a shorter strip used at the top of inner pages so the branding carries
// through everywhere without crowding the actual content underneath it.
export default function HeroBanner({
  variant = "slim",
  children,
  className = "",
}: {
  variant?: "full" | "slim";
  children?: React.ReactNode;
  className?: string;
}) {
  const src = variant === "full" ? "/hero/hero-full.webp" : "/hero/hero-slim.webp";
  // These fixed pixel heights assume a portrait phone or a desktop window,
  // where there's plenty of vertical room to spare. In landscape on a
  // phone the whole viewport can be shorter than the "full" variant's
  // height alone (as little as ~375px on some iPhones), which would either
  // push all real page content off-screen or, worse, clip the hero's own
  // headline/CTA content since the container also clips overflow. The
  // `landscape:` variant swaps to an intrinsic height there instead of a
  // fixed one, so the banner shrinks to fit its actual content (or, for
  // the content-free "slim" banner, a much shorter fixed strip) rather
  // than eating the whole screen.
  const heightClass =
    variant === "full"
      ? "h-[380px] sm:h-[460px] landscape:h-auto"
      : "h-[110px] sm:h-[140px] landscape:h-[64px]";
  const contentPaddingClass = variant === "full" ? "py-10 landscape:py-6" : "";

  return (
    <div className={`relative w-full overflow-hidden bg-sage-100 ${heightClass} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      {children && (
        <div
          className={`relative z-10 flex min-h-full flex-col items-center justify-center px-6 text-center ${contentPaddingClass}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

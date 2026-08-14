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
  const heightClass =
    variant === "full" ? "h-[380px] sm:h-[460px]" : "h-[110px] sm:h-[140px]";

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
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
          {children}
        </div>
      )}
    </div>
  );
}

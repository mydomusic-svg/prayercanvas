import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import HeroBanner from "./hero-banner";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-col">
      <HeroBanner variant="full">
        <Image
          src="/logo-mark.png"
          alt=""
          width={72}
          height={72}
          className="mb-4 h-16 w-16 sm:h-[72px] sm:w-[72px]"
          priority
        />
        <h1 className="font-headline text-4xl font-bold tracking-tight text-sage-900 sm:text-6xl">
          PrayerMessenger
        </h1>
        <p className="mt-3 text-2xl font-bold text-sage-700 sm:text-3xl">
          Send a prayer message.
        </p>
        <p className="mt-4 max-w-lg text-base text-sage-700 sm:text-lg">
          Speak a prayer. We&apos;ll clean it up, add fitting music and
          visuals, and turn it into a beautiful video you can share.
        </p>

        <div className="mt-7 flex gap-3">
          {user ? (
            <>
              <Link
                href="/create"
                className="rounded-full bg-sage-600 px-6 py-3 text-white shadow-sm transition hover:bg-sage-700"
              >
                Create a Prayer
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full border border-sage-400 bg-white/70 px-6 py-3 text-sage-900 backdrop-blur transition hover:bg-white"
              >
                My Prayers
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-sage-600 px-6 py-3 text-white shadow-sm transition hover:bg-sage-700"
            >
              Get Started
            </Link>
          )}
        </div>
      </HeroBanner>

      {/* Mission statement — the "why" behind PrayerMessenger, kept bold
          and positive per the brand refresh: anyone should be able to send
          a prayer message to anyone else, at any moment it's needed. */}
      <section className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
        <p className="font-headline text-2xl font-bold leading-snug text-sage-900 sm:text-4xl">
          Everyone deserves to feel prayed for.
        </p>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-sage-700 sm:text-lg">
          PrayerMessenger makes it easy to send a prayer message to anyone,
          anytime — a friend going through something hard, a family member
          celebrating good news, or someone who just needs to know they
          aren&apos;t alone. Speak from the heart for a minute, and
          we&apos;ll turn it into a beautiful video message carrying hope,
          comfort, and love straight to the people who need it most.
        </p>
      </section>
    </main>
  );
}

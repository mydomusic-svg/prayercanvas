import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">PrayerCanvas</h1>
        <p className="text-lg text-neutral-600">
          Speak a prayer. We&apos;ll clean it up, add fitting music and
          visuals, and turn it into a beautiful video you can share.
        </p>
      </div>

      <div className="flex gap-3">
        {user ? (
          <>
            <Link
              href="/create"
              className="rounded-full bg-neutral-900 px-6 py-3 text-white transition hover:bg-neutral-700"
            >
              Create a Prayer
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-neutral-300 px-6 py-3 transition hover:bg-neutral-100"
            >
              My Prayers
            </Link>
          </>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-neutral-900 px-6 py-3 text-white transition hover:bg-neutral-700"
          >
            Get Started
          </Link>
        )}
      </div>
    </main>
  );
}

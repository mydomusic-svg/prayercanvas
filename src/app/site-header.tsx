import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import AccountMenu from "./account-menu";

// A small persistent header so users can always get back to their list of
// rendered videos — previously the only way back to /dashboard was the
// homepage, so once you were on /create or a prayer detail page there was
// no way back except the browser's back button.
export default async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // public.users.display_name is auto-populated from auth signup metadata
  // (or falls back to email) via a DB trigger — see supabase/migrations.
  // This is what recipients/other users should see instead of the raw
  // email address.
  let displayName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    displayName = profile?.display_name ?? null;
  }

  return (
    <header
      className="border-b border-sage-200"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <Link
          href={user ? "/dashboard" : "/"}
          className="flex shrink-0 items-center gap-2"
        >
          <Image
            src="/logo-mark.png"
            alt=""
            width={40}
            height={40}
            className="h-9 w-9 sm:h-10 sm:w-10"
            priority
          />
          <span className="font-headline text-2xl font-bold tracking-tight text-sage-900 sm:text-3xl">
            PrayerMessenger
          </span>
        </Link>
        {user && (
          <nav className="flex items-center gap-2 text-sm sm:gap-4">
            <Link
              href="/dashboard"
              className="hidden text-sage-600 hover:text-sage-900 sm:inline"
            >
              My Prayers
            </Link>
            <Link
              href="/bible"
              className="text-sage-600 hover:text-sage-900"
            >
              Bible
            </Link>
            <Link
              href="/pricing"
              className="hidden text-sage-600 hover:text-sage-900 sm:inline"
            >
              Pricing
            </Link>
            <Link
              href="/create"
              className="rounded-full bg-sage-600 px-3 py-1.5 text-white transition hover:bg-sage-700 sm:px-4"
            >
              <span className="hidden sm:inline">+ New Prayer</span>
              <span className="sm:hidden" aria-hidden>
                +
              </span>
              <span className="sr-only sm:hidden">New Prayer</span>
            </Link>
            <AccountMenu email={user.email ?? null} displayName={displayName} />
          </nav>
        )}
      </div>
    </header>
  );
}

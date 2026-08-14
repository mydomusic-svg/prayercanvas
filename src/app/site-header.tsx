import Link from "next/link";
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

  return (
    <header
      className="border-b border-neutral-200"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3 sm:px-6 sm:py-4">
        <Link href={user ? "/dashboard" : "/"} className="shrink-0 font-semibold">
          PrayerCanvas
        </Link>
        {user && (
          <nav className="flex items-center gap-2 text-sm sm:gap-4">
            <Link
              href="/dashboard"
              className="hidden text-neutral-600 hover:text-neutral-900 sm:inline"
            >
              My Prayers
            </Link>
            <Link
              href="/create"
              className="rounded-full bg-neutral-900 px-3 py-1.5 text-white transition hover:bg-neutral-700 sm:px-4"
            >
              <span className="hidden sm:inline">+ New Prayer</span>
              <span className="sm:hidden" aria-hidden>
                +
              </span>
              <span className="sr-only sm:hidden">New Prayer</span>
            </Link>
            <AccountMenu email={user.email ?? null} />
          </nav>
        )}
      </div>
    </header>
  );
}

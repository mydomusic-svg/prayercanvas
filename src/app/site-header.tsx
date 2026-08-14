import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
        <Link href={user ? "/dashboard" : "/"} className="font-semibold">
          PrayerCanvas
        </Link>
        {user && (
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-neutral-600 hover:text-neutral-900">
              My Prayers
            </Link>
            <Link
              href="/create"
              className="rounded-full bg-neutral-900 px-4 py-1.5 text-white transition hover:bg-neutral-700"
            >
              + New Prayer
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

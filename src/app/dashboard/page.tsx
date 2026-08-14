import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: prayers } = await supabase
    .from("prayers")
    .select("id, recipient_name, occasion, title, theme, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Prayers</h1>
        <Link
          href="/create"
          className="rounded-full bg-neutral-900 px-5 py-2 text-sm text-white transition hover:bg-neutral-700"
        >
          + New Prayer
        </Link>
      </div>

      {!prayers || prayers.length === 0 ? (
        <p className="text-neutral-500">
          You haven&apos;t created a prayer yet.{" "}
          <Link href="/create" className="underline">
            Create your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {prayers.map((prayer) => (
            <li key={prayer.id}>
              <Link
                href={`/prayers/${prayer.id}`}
                className="block rounded-lg border border-neutral-200 px-5 py-4 transition hover:bg-neutral-50"
              >
                <p className="font-medium">
                  {prayer.title ||
                    (prayer.recipient_name
                      ? `A Prayer for ${prayer.recipient_name}`
                      : "Untitled Prayer")}
                </p>
                <p className="text-sm text-neutral-500">
                  {prayer.occasion ?? "—"} ·{" "}
                  {new Date(prayer.created_at).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

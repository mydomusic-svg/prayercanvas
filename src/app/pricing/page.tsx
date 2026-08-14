import { createClient } from "@/lib/supabase/server";
import HeroBanner from "../hero-banner";
import CheckoutButton from "./checkout-button";

export const metadata = { title: "Pricing — PrayerMessenger" };

export default async function PricingPage() {
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("app_settings")
    .select("billing_enabled")
    .maybeSingle();
  const billingEnabled = settings?.billing_enabled ?? false;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let usedThisMonth = 0;
  let plan: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    plan = profile?.plan ?? "free";

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("prayers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", startOfMonth.toISOString());
    usedThisMonth = count ?? 0;
  }

  return (
    <>
      <HeroBanner variant="slim" />
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-16">
        <div className="text-center">
          <h1 className="font-headline text-3xl font-bold text-sage-900 sm:text-4xl">
            Pricing
          </h1>
          <p className="mt-3 text-sage-700">
            Send a prayer message to anyone, anytime — free to start, simple
            to grow with.
          </p>
          {!billingEnabled && (
            <p className="mx-auto mt-4 max-w-md rounded-full bg-sage-100 px-4 py-2 text-sm text-sage-700">
              PrayerMessenger is free for everyone while we&apos;re in
              testing — paid plans are coming soon.
            </p>
          )}
          {user && (
            <p className="mt-4 text-sm text-sage-500">
              You&apos;re on the {plan === "plus" ? "Plus" : "Free"} plan
              {plan !== "plus" && ` — ${usedThisMonth} of 2 free videos used this month`}
              .
            </p>
          )}
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-sage-200 bg-white p-8 text-center">
            <h2 className="font-headline text-2xl font-semibold text-sage-900">
              Free
            </h2>
            <p className="text-3xl font-bold text-sage-900">$0</p>
            <p className="text-sm text-sage-600">
              2 prayer videos every month, on us.
            </p>
            <p className="mt-auto text-xs text-sage-400">Always free</p>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-sage-600 bg-white p-8 text-center shadow-sm">
            <span className="rounded-full bg-sage-600 px-3 py-1 text-xs font-medium text-white">
              Most popular
            </span>
            <h2 className="font-headline text-2xl font-semibold text-sage-900">
              PrayerMessenger Plus
            </h2>
            <p className="text-3xl font-bold text-sage-900">
              $6.99<span className="text-base font-normal text-sage-500">/mo</span>
            </p>
            <p className="text-sm text-sage-600">
              Unlimited prayer videos, every style, no limits.
            </p>
            <div className="mt-auto flex flex-col gap-2">
              <CheckoutButton
                plan="monthly"
                label="Subscribe monthly"
                billingEnabled={billingEnabled}
              />
              <CheckoutButton
                plan="yearly"
                label="Subscribe yearly — $49.99/yr"
                billingEnabled={billingEnabled}
                className="!bg-transparent !text-sage-600 !border !border-sage-300 hover:!bg-sage-50"
              />
            </div>
          </div>

          <div className="flex flex-col items-center gap-4 rounded-2xl border border-sage-200 bg-white p-8 text-center">
            <h2 className="font-headline text-2xl font-semibold text-sage-900">
              Pay as you go
            </h2>
            <p className="text-3xl font-bold text-sage-900">
              $1.99<span className="text-base font-normal text-sage-500">/video</span>
            </p>
            <p className="text-sm text-sage-600">
              Past your 2 free videos this month? Send one more without
              subscribing.
            </p>
            <div className="mt-auto">
              <CheckoutButton
                plan="per_send"
                label="Buy 1 video"
                billingEnabled={billingEnabled}
              />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

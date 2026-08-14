import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getStripe,
  STRIPE_PRICE_MONTHLY,
  STRIPE_PRICE_YEARLY,
  STRIPE_PRICE_PER_SEND,
} from "@/lib/stripe";

type Plan = "monthly" | "yearly" | "per_send";

const PRICE_BY_PLAN: Record<Plan, string | undefined> = {
  monthly: STRIPE_PRICE_MONTHLY,
  yearly: STRIPE_PRICE_YEARLY,
  per_send: STRIPE_PRICE_PER_SEND,
};

/**
 * Starts a Stripe Checkout session for one of the three purchasable things:
 * the monthly or yearly PrayerMessenger Plus subscription, or a single
 * pay-per-send credit. Returns the Checkout URL to redirect the browser to
 * — this app has no billing_enabled=true deployment yet, so this route is
 * unreachable from the UI until that flag flips and STRIPE_* env vars are
 * set, but it's fully wired so turning billing on later needs no code
 * changes.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { plan?: Plan };
  const plan = body.plan;

  if (!plan || !(plan in PRICE_BY_PLAN)) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const priceId = PRICE_BY_PLAN[plan];
  if (!priceId) {
    return NextResponse.json(
      { error: `Billing isn't fully configured yet (missing price id for "${plan}").` },
      { status: 503 }
    );
  }

  const origin = new URL(request.url).origin;

  try {
    const stripe = getStripe();
    const admin = createAdminClient();

    // Reuse an existing Stripe customer for this user if we've already
    // created one, so repeat purchases/subscriptions land on one customer
    // record instead of fragmenting across several.
    const { data: profile } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin.from("users").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: plan === "per_send" ? "payment" : "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      metadata: { supabase_user_id: user.id, plan },
      subscription_data:
        plan === "per_send" ? undefined : { metadata: { supabase_user_id: user.id, plan } },
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Failed to create Stripe Checkout session:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 500 }
    );
  }
}

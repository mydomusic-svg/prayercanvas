import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

/**
 * Opens the Stripe Billing Portal so a subscribed user can update their
 * card, switch monthly/yearly, or cancel — without PrayerMessenger having
 * to build any of that UI itself.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("users")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account found for this user yet." },
        { status: 404 }
      );
    }

    const origin = new URL(request.url).origin;
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/dashboard`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Failed to create Stripe Billing Portal session:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not open billing portal" },
      { status: 500 }
    );
  }
}

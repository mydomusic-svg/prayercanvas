import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe calls this whenever a checkout completes or a subscription changes
 * state. It's the single source of truth that keeps public.users.plan /
 * subscription_status / extra_credits in sync with what was actually paid
 * for — never trust the client for that. Unreachable in practice until
 * STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are set and a webhook endpoint
 * pointing here is registered in the Stripe dashboard.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      // A Checkout Session finished — for one-off pay-per-send purchases
      // this is the only event we get, so grant the credit right here. For
      // subscriptions, the subscription.* events below carry the ongoing
      // status; this event just tells us which user to attach the new
      // Stripe subscription/customer to.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan;
        if (!userId) break;

        if (plan === "per_send") {
          const { data: profile } = await admin
            .from("users")
            .select("extra_credits")
            .eq("id", userId)
            .maybeSingle();
          await admin
            .from("users")
            .update({ extra_credits: (profile?.extra_credits ?? 0) + 1 })
            .eq("id", userId);
        } else if (typeof session.subscription === "string") {
          await admin
            .from("users")
            .update({ stripe_subscription_id: session.subscription })
            .eq("id", userId);
        }
        break;
      }

      // Fired on creation and on every renewal/change — this is what keeps
      // subscription_status (active/trialing/past_due/canceled/etc.) fresh.
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await admin
          .from("users")
          .update({
            plan: "plus",
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
          })
          .eq("id", userId);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.supabase_user_id;
        if (!userId) break;

        await admin
          .from("users")
          .update({ plan: "free", subscription_status: "canceled" })
          .eq("id", userId);
        break;
      }

      default:
        // Ignore anything else — invoices, payment method events, etc.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handler failed:", err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

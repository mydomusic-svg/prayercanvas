import Stripe from "stripe";

/**
 * Lazily-constructed Stripe client. Reading STRIPE_SECRET_KEY at call time
 * (rather than at module load) means the app builds and runs fine with no
 * Stripe account configured at all — the billing UI stays hidden behind
 * app_settings.billing_enabled, and nothing ever calls this until a real
 * key is set. Throws a clear error if something does try to use it first.
 */
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Billing isn't configured yet — see README for activation steps."
    );
  }

  stripeClient = new Stripe(key, {
    apiVersion: "2026-07-29.dahlia",
  });
  return stripeClient;
}

// Price IDs for the three purchasable things — created in the Stripe
// dashboard (or via the Stripe MCP connector) when billing is activated.
export const STRIPE_PRICE_MONTHLY = process.env.STRIPE_PRICE_MONTHLY;
export const STRIPE_PRICE_YEARLY = process.env.STRIPE_PRICE_YEARLY;
export const STRIPE_PRICE_PER_SEND = process.env.STRIPE_PRICE_PER_SEND;

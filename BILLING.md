# Turning on billing

PrayerMessenger's billing system is fully built but **inactive**. Every user
gets unlimited free videos right now, regardless of plan, because
`app_settings.billing_enabled` is `false` in the database. Nothing below
needs to happen for the app to keep working exactly as it does today — this
is only for when you're ready to start charging.

## What's already built

- **Pricing model:** Free (2 videos/month), PrayerMessenger Plus
  ($4.99/mo or $39.99/yr, unlimited), and pay-per-send ($1.49/video) for
  free-tier users who don't want to subscribe.
- **`/pricing` page** — shows all three tiers. Buttons are disabled
  ("Coming soon") while billing is off.
- **Quota enforcement** — a Postgres trigger (`enforce_prayer_quota`) on
  `public.prayers`, not app code. It's a no-op while `billing_enabled` is
  false, so nothing to break. Once enabled it blocks a free user's 3rd
  video/month with an error the create page already catches and turns into
  an upgrade prompt.
- **Stripe integration** — `/api/stripe/checkout` (starts a Checkout
  session for monthly/yearly/one-off), `/api/stripe/webhook` (keeps
  `public.users.plan` / `subscription_status` / `extra_credits` in sync with
  Stripe), `/api/stripe/portal` (lets subscribers manage/cancel their own
  billing).

## Steps to go live

1. **Create a Stripe account** at https://dashboard.stripe.com if you don't
   have one yet. Free to create; you only need to finish full activation
   (business details, bank account) before you can accept *real* charges —
   test mode works immediately with no activation.

2. **Create three Prices in Stripe** (Dashboard → Product catalog, or ask
   me to do it via the Stripe MCP connector once it's connected in this
   chat):
   - "PrayerMessenger Plus" — recurring, $4.99/month
   - "PrayerMessenger Plus" — recurring, $39.99/year
   - "Prayer video" — one-time, $1.49

   Copy each Price ID (starts with `price_...`).

3. **Set environment variables** in Vercel (Project Settings → Environment
   Variables) and your local `.env.local`:
   - `STRIPE_SECRET_KEY` — Developers → API keys in the Stripe dashboard.
     Start with the **test mode** secret key (`sk_test_...`) to try the
     whole flow with fake cards before going live.
   - `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `STRIPE_PRICE_PER_SEND`
     — the three Price IDs from step 2.
   - `STRIPE_WEBHOOK_SECRET` — see step 4.

4. **Register the webhook.** In Stripe Dashboard → Developers → Webhooks,
   add an endpoint pointing at
   `https://prayercanvas.vercel.app/api/stripe/webhook`, subscribed to:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`. Stripe
   gives you a signing secret (`whsec_...`) — that's
   `STRIPE_WEBHOOK_SECRET`.

5. **Test it in Stripe test mode first.** With test keys set, subscribe
   using Stripe's test card `4242 4242 4242 4242` (any future expiry, any
   CVC) and confirm: the Checkout redirect works, the webhook fires (check
   Stripe Dashboard → Webhooks → your endpoint → recent deliveries), and
   `public.users.plan` flips to `plus` for that test account.

6. **Flip the switch.** Once you're happy with testing, run this in the
   Supabase SQL Editor:

   ```sql
   update public.app_settings set billing_enabled = true;
   ```

   Free-tier quota enforcement and the pricing page's buttons activate
   immediately — no redeploy needed.

7. **Go live for real money.** Finish Stripe's account activation, swap the
   test-mode keys for live keys (`sk_live_...`), create live-mode versions
   of the three Prices (test and live Prices are separate), and update the
   env vars + webhook endpoint to match.

## Rolling it back

Set `app_settings.billing_enabled` back to `false` at any time — every user
immediately goes back to unlimited free access, no code changes needed.

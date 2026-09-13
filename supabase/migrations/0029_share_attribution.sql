-- DOES THE SHARE LOOP ACTUALLY WORK?
--
-- The app's only growth mechanism is a prayer being sent to someone, that
-- person watching it, and deciding to make one themselves. Everything about
-- marketing this app depends on one number — what fraction of people who
-- open a share link go on to create — and that number was unmeasurable.
-- share_links.view_count has always counted views, so we knew how many
-- people looked. Nobody knew how many of them stayed.
--
-- Deliberately NOT a third-party analytics service. This app handles voice
-- recordings and prayers about illness and grief, and the privacy policy
-- published this week names every processor that receives data. Adding
-- PostHog or similar for one number would mean a new processor, a new entry
-- in that policy, and plausibly a consent banner — a large amount of
-- surface for a question a single text column answers.
--
-- One column, no events table, no session tracking, no cross-site
-- identifiers. When someone lands on a share link the token is remembered
-- in a first-party cookie; if they sign up within 30 days, the token they
-- arrived through is recorded here. That is the whole mechanism.
--
-- It is deliberately coarse: it cannot tell you which prayer persuaded them
-- if they opened several, and it misses anyone who arrives on one device
-- and signs up on another. Both are acceptable. The question is "does the
-- loop convert at all, roughly", not "attribute this signup precisely", and
-- a coarse honest number beats a precise invented one.
alter table public.users
  add column if not exists referred_by_share_token text;

comment on column public.users.referred_by_share_token is
  'The share link this user arrived through before signing up, if any. Set once at signup from a first-party cookie. Coarse by design — see 0029.';

-- The stats page asks "how many users have this set, grouped by token", and
-- the column is null for almost every row, so a partial index keeps it
-- small and is the only shape the query ever uses.
create index if not exists users_referred_by_share_token_idx
  on public.users (referred_by_share_token)
  where referred_by_share_token is not null;

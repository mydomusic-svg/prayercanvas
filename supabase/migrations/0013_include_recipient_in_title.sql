-- Recipient name used to always leak into the title/video whenever no title
-- had been generated yet (fallback: "A Prayer for {name}"). Most prayers get
-- shared with whoever the user likes, not just the one person named at
-- creation, so that made the title feel misdirected on reshare. Recipient
-- name stays available (still useful context for the AI title/theme
-- detection, and some users do want to name someone specific), but whether
-- it's actually allowed to show up in the burned-in title/video text is now
-- an explicit opt-in the user checks at creation time.
alter table public.prayers
  add column if not exists include_recipient_in_title boolean not null default false;

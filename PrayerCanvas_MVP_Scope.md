# PrayerCanvas — MVP Scope & Build Plan

**Prepared:** August 12, 2026
**Stack:** Next.js (React/TypeScript) · Supabase (Auth, Postgres, Storage) · Vercel (hosting) · GitHub (source control)

---

## 1. Product Vision

PrayerCanvas turns a spoken prayer into a polished, shareable video. A user records a sincere spoken prayer; the platform cleans the audio, transcribes it, detects its emotional theme, pairs it with fitting instrumental music and visuals, and renders a finished vertical or landscape video ready to send privately or share publicly.

The differentiator is **creation**, not community. Existing prayer apps (Send A Prayer, iToro, Echo Prayer) focus on recording, organizing, and communicating prayers. PrayerCanvas's wedge is automatic, cinematic media production — closer to "Canva/CapCut for personal prayers" than a prayer journal or social feed.

**One-line pitch:** Speak a prayer → AI enhances the audio → adds fitting music and visuals → creates a beautiful shareable prayer video.

**Example experience:** A user records "Father, please watch over Marcus as he starts his new job tomorrow..." The platform cleans the voice, adds gentle piano, applies a sunrise visual, animates key phrases as captions, and renders a finished 9:16 video ready for text or social media.

---

## 2. The One Question the MVP Must Answer

> **Will people record a prayer and value an automatically produced prayer video enough to actually send or share it?**

Everything in this MVP is scoped to answer that question as cheaply and quickly as possible. No social network, no community features, no admin tooling — just the creation loop, end to end, working well.

---

## 3. MVP Feature Set

**In scope for v1:**

- Account creation and a simple profile (Supabase Auth — email/password and/or magic link)
- Record or upload a spoken prayer (browser mic capture, or file upload as a fallback)
- Optional recipient name and occasion field
- Automatic speech-to-text transcription
- Basic audio cleanup / loudness normalization
- Choice of one of 4–6 visual styles: Nature, Cinematic, Minimal, Celebration, Scripture, Peaceful
- Choice of, or automatic recommendation for, an instrumental mood/theme
- Auto-generated captions and a suggested prayer title
- Server-side render of a 30–90 second shareable video (MP4)
- Private share link with download/export
- Prayer history so a user can reopen and re-download prior creations

**Explicitly out of scope for v1** (Phase 2+ candidates):

- Full church/social network, follower or friend systems
- Live prayer rooms or calling
- Prayer groups, group administration, or ministry channels
- AI avatars
- A full video editor (trimming, multi-clip, manual timeline)
- Marketplace features, premium style packs as a storefront
- More than one or two pricing tiers

Holding this line is the main execution risk for a solo/small build — it's tempting to add community features early. Resist it until the core loop (record → render → share) has proven people actually share the output.

---

## 4. MVP User Flow

| Step | Action |
|---|---|
| 1. Create | Tap "Create a Prayer" |
| 2. Personalize | Enter recipient name / occasion / optional title |
| 3. Record | Speak naturally into the phone or computer mic (or upload audio) |
| 4. Enhance | AI transcribes the audio, cleans it, and detects the theme/mood |
| 5. Style | User accepts or overrides the suggested music + visual theme |
| 6. Preview | Review captions, title, audio, and animation before rendering |
| 7. Render | Server renders the final MP4 (async job, with progress) |
| 8. Share | Text, copy link, post, or download the finished video |

---

## 5. Technical Architecture

| Layer | MVP Choice | Notes |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind | Deployed on Vercel; mobile-responsive recording UI using `MediaRecorder` API |
| Auth / Database | Supabase Auth + Postgres | Row-Level Security scoped by `user_id` from day one |
| Media Storage | Supabase Storage | Buckets for raw audio, background assets, rendered videos |
| Speech-to-text | Managed STT API (e.g., OpenAI Whisper API, Deepgram, or AssemblyAI) | Pick one now — Whisper API is the simplest to start with given you'll likely already touch an LLM provider for theme/title generation |
| Theme/Title/Captions | LLM API (e.g., Anthropic or OpenAI) | Takes the transcript, returns detected theme, suggested title, caption segments, optional scripture reference |
| Audio processing | FFmpeg (server-side) | Loudness normalization, noise gate/cleanup, fades, mixing voice + music bed |
| Video rendering | FFmpeg-based worker | Combines voice track, music, background loop/image, and burned-in or overlay captions |
| Jobs / async rendering | Background worker + job queue | Vercel serverless functions have execution time limits, so rendering should run outside the request/response cycle — see §5.1 |
| Sharing | Public/private share page | Server-rendered page per `share_links.token`, Open Graph tags for link previews, direct MP4 download |

### 5.1 Why rendering needs its own worker (important early decision)

FFmpeg rendering is CPU/time-intensive and Vercel serverless functions are not built for long-running jobs. Recommended MVP pattern:

1. Web app creates a `render_jobs` row and uploads assets to Supabase Storage.
2. A separate worker process (not on Vercel) picks up pending jobs — options, roughly in order of setup simplicity:
   - A small worker service on **Railway** or **Fly.io** running Node + FFmpeg, polling Supabase for `status = 'pending'` jobs (simplest to reason about, no extra queue infra).
   - A Supabase Edge Function that enqueues to a hosted queue (e.g., Upstash QStash) which calls the worker via webhook.
3. Worker updates `render_jobs.status`/`progress` as it works, uploads the final MP4 to Storage, and writes the `output_url`.
4. Frontend polls (or subscribes via Supabase Realtime) for job status and shows progress, then reveals the finished video.

This is the one piece of the stack that goes beyond "Vercel + Supabase" — plan for a small always-on or on-demand worker (Railway is a reasonable default; you already have relevant tooling available).

---

## 6. Minimum Data Model

```
users
  id, display_name, email, created_at

prayers
  id, user_id, recipient_name, occasion, title,
  transcript, theme, privacy, created_at

media_assets
  id, prayer_id, type, storage_url, duration, metadata

render_jobs
  id, prayer_id, status, progress, error,
  output_url, created_at, completed_at

styles
  id, name, visual_asset, music_asset, caption_template

share_links
  id, prayer_id, token, expires_at, view_count
```

A ready-to-run Supabase SQL migration for this schema (with RLS policies) is included in the starter repo delivered alongside this document.

---

## 7. Monetization Hypotheses (not built in v1, but worth keeping in mind)

- Free tier: limited renders per month
- Creator subscription: more renders, premium visuals, longer videos, watermark removal
- Church/ministry plan: org profiles, branded templates, group tools
- Premium music/visual packs
- Gift prayer packages for milestones (weddings, births, graduations, memorials)

---

## 8. Suggested Build Order (Sprints)

**Sprint 1 — Foundation**
Repo setup, Supabase project + Auth, database schema/migrations, basic recording/upload UI, prayer creation screen.

**Sprint 2 — Intelligence**
Speech-to-text integration, LLM theme/title/caption generation, audio cleanup pipeline.

**Sprint 3 — Rendering**
Style templates (visual + music pairing), FFmpeg mixing, worker service, render job queue and status polling.

**Sprint 4 — Sharing & History**
Preview screen, public/private share page with OG metadata, export/download, prayer history list.

**Sprint 5 — Polish & Beta**
Error handling, basic analytics (creation completion, render completion, share rate, repeat creation, recipient views), privacy controls, invite a small beta group.

**Success signal:** users create a prayer, finish the render, and actually send or share the result. Track creation completion rate, render completion rate, share rate, repeat-creation rate, and recipient view count from Sprint 1 onward, even with rough instrumentation.

---

## 9. Your Stack, Mapped to Setup Steps

You already have VS Code, Supabase, Vercel, and GitHub accounts. Practical order of operations:

1. **GitHub** — create a new repo (e.g. `prayercanvas`), clone it locally, open in VS Code.
2. **Supabase** — create a new project; note the project URL and anon/public key. Run the included migration to create the schema. Enable email auth (and optionally magic link).
3. **Local env** — copy `.env.example` to `.env.local` in the starter repo, fill in Supabase URL/anon key, and your STT + LLM API keys once chosen.
4. **Vercel** — import the GitHub repo as a new Vercel project; set the same environment variables in Vercel's project settings; every push to `main` auto-deploys.
5. **Worker (Sprint 3)** — when you get to rendering, stand up a small Node service (Railway is a good fit) with FFmpeg available, pointed at the same Supabase project via the service-role key.

Everything through Sprint 2 (auth, DB, recording, transcription, theme detection) can run entirely on Vercel + Supabase with no extra infrastructure — the worker is only needed once you reach actual video rendering in Sprint 3.

---

## 10. Additional Accounts/Services You'll Need

- **Speech-to-text provider** (choose one): OpenAI Whisper API, Deepgram, or AssemblyAI
- **LLM provider** for theme/title/caption generation (choose one): Anthropic API or OpenAI API
- **Worker hosting** for FFmpeg rendering (Sprint 3+): Railway or Fly.io are the simplest fits
- **Stock music/visual assets** for the initial 4–6 style templates — either license a small starter pack or generate/commission placeholders for the MVP

Everything else — auth, database, storage, hosting, deploys, version control — is covered by Supabase, Vercel, and GitHub, which you already have.

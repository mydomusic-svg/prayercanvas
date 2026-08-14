# PrayerCanvas — MVP Starter

A Next.js + Supabase starter for PrayerCanvas: record a spoken prayer, get it transcribed and theme-detected, style it, and (once the render worker is wired up) get back a shareable video. See `../PrayerCanvas_MVP_Scope.md` for the full product scope and build plan this repo implements.

## What's already wired up

- Supabase Auth (email/password) — `src/app/login`
- Prayer creation flow: recipient/occasion, mic recording via `MediaRecorder` or file upload, style picker, upload to Supabase Storage — `src/app/create`
- **Transcription + theme/title detection (Sprint 2)** — Whisper API transcribes the recording, Claude detects the theme and suggests a title, both run automatically right after a prayer is created, with a manual retry button on the prayer page if it fails — `src/lib/ai/`, `src/app/api/prayers/[id]/process`
- Dashboard listing a user's prayers — `src/app/dashboard`
- Prayer detail page showing transcript, theme, caption timing, and render status/output — `src/app/prayers/[id]`
- Public share page by token — `src/app/p/[token]`
- Full Postgres schema with Row Level Security, plus Storage upload policies — `supabase/migrations/`
- Session-refresh proxy (Next.js 16 renamed `middleware.ts` to `proxy.ts`) — `src/proxy.ts`

## What's intentionally stubbed (Sprint 3 in the scope doc)

- FFmpeg audio cleanup (loudness normalization, noise reduction)
- Actual video rendering (voice + music + background + burned-in captions → MP4)

The `render_jobs` table and row already exist for every new prayer with `status = 'pending'`; the missing piece is a worker that watches that table, does the FFmpeg work, and writes back `status`, `progress`, and `output_url`. The `prayers.captions` column already has Whisper's real segment timestamps ready for the worker to use. See §5.1 of the scope doc for a suggested approach (a small Node + FFmpeg service on Railway or Fly.io).

## Setup

### 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the migrations in order: `supabase/migrations/0001_init.sql`, then `0002_storage_policies.sql`, then `0003_prayer_captions.sql` (or use the Supabase CLI: `supabase link` then `supabase db push`).
3. In **Storage**, create a bucket named `prayer-audio` and mark it **public** (public only covers *reads* — `0002_storage_policies.sql` adds the RLS policies that allow authenticated *uploads*, which is easy to miss).
4. In **Authentication → Providers**, email/password is enabled by default — no change needed. If you want to skip email confirmation for local testing, turn off **Confirm email** under Authentication settings.
5. Grab your project URL, anon key, and service role key from **Project Settings → API**.

### 2. Local environment

```bash
cp .env.example .env.local
```

Fill in the Supabase values from above. For transcription and theme detection to work, also add:
- `OPENAI_API_KEY` — from [platform.openai.com/api-keys](https://platform.openai.com/api-keys), used for Whisper transcription
- `ANTHROPIC_API_KEY` — from [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys), used for theme/title detection

Leaving either blank doesn't break prayer creation — the prayer still saves, transcription just fails gracefully and you can retry once keys are added (the prayer page shows a "Transcribe & Analyze" button whenever `transcript` is empty).

### 3. Install and run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, sign up, and try the create-prayer flow.

### 4. Deploy

1. Push this repo to GitHub.
2. Import it into Vercel.
3. Add the same environment variables from `.env.local` to the Vercel project (**Settings → Environment Variables**).
4. Every push to `main` auto-deploys.

## Project structure

```
src/
  app/
    page.tsx                    Landing page
    login/                       Auth
    create/                      Record/upload + style picker + submit + kicks off processing
    dashboard/                    List of a user's prayers
    prayers/[id]/                 Prayer detail + transcript/theme + render status + share link
      process-button.tsx           Manual retry for transcription/analysis
    p/[token]/                    Public share page
    api/prayers/[id]/process/      Route handler: transcribe + detect theme/title
  lib/
    ai/
      transcribe.ts                Whisper transcription (returns text + segment timestamps)
      analyze.ts                   Claude theme/title detection
    supabase/
      client.ts                   Browser Supabase client
      server.ts                    Server Component / Route Handler client
      admin.ts                     Service-role client (server-only, bypasses RLS)
      middleware.ts                 Session-refresh helper used by proxy.ts
    types.ts                     Shared TypeScript types matching the DB schema
  proxy.ts                      Next.js 16 proxy (formerly middleware.ts) — refreshes auth session
supabase/
  migrations/
    0001_init.sql                Full schema + RLS policies + seed styles
    0002_storage_policies.sql     Storage upload/read/delete RLS for prayer-audio bucket
    0003_prayer_captions.sql      Adds prayers.captions (Whisper segment timestamps)
```

## Notes for this Next.js version

This repo was scaffolded on Next.js 16, which renamed `middleware.ts` to `proxy.ts` and made several APIs async by default (route `params`, `cookies()`, etc.) — already accounted for in this codebase. If you add new dynamic routes, remember `params` arrives as a `Promise` and must be awaited.

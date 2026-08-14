# PrayerCanvas render worker (Sprint 3)

Turns a `render_jobs` row with `status = 'pending'` into a finished MP4:
downloads the prayer's audio, generates a vertical background video themed
by the chosen style, burns in the title and Whisper-synced captions (from
Sprint 2), muxes in the original voice recording, and uploads the result to
Supabase Storage.

No stock footage or music is used. The background is generated procedurally
with ffmpeg (a solid color per style, see `STYLE_THEMES` in `index.js`) so
there's nothing to license or source to get a working MVP. Swapping in real
background loops and a music bed per style — as described in the product
scope — is the natural next step once you have assets to drop in; the
`styles` table already has `visual_asset` / `music_asset` columns reserved
for that.

## Why this is a separate service

Video rendering is CPU/time-intensive and doesn't fit Vercel's serverless
function limits. This worker is a small always-on Node process meant to run
somewhere else — Railway and Fly.io are good fits since both support a
`Dockerfile`-based deploy with a persistent process. It talks to the same
Supabase project as the Next.js app, using the service role key so it can
read every pending job regardless of whose prayer it is.

## Local testing

```bash
cp .env.example .env
# fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (same values as the
# main app's .env.local)
npm install
node --env-file=.env index.js
```

It polls every `POLL_INTERVAL_MS` (default 5s). Create a prayer in the app
and watch this process pick up the job, render it, and mark it complete —
refresh the prayer's page in the app to see the finished video.

Requires `ffmpeg` and `ffprobe` on PATH locally. On macOS: `brew install
ffmpeg`. The `Dockerfile` handles this automatically for deployment.

## Deploying

1. Push this repo to GitHub (the worker lives in the `worker/` subfolder).
2. Create a new service on Railway (or Fly.io) pointed at this repo, with
   **Root Directory** set to `worker/` so it builds from the `Dockerfile`
   here instead of the Next.js app at the repo root.
3. Set the two environment variables from `.env.example`.
4. Deploy. Check logs for `PrayerCanvas render worker started.` — that
   confirms it's polling.

There's no HTTP server here — it's a background poller, so no domain/port
setup is needed on the hosting side.

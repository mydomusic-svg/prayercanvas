# Render worker

Environment variables (Railway):

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key |
| `FREE_VIDEO_RETENTION_HOURS` | no (24) | When an UNSHARED free video is swept |
| `SHARED_VIDEO_RETENTION_HOURS` | no (720) | When a SHARED free video is swept |
| `SENTRY_DSN` | no | Error reporting; inert without it |
| `RESEND_API_KEY` | no | Render-ready emails; inert without it |
| `MAIL_FROM` | no | Defaults to `PrayerMessenger <prayers@prayermessenger.com>` |
| `APP_URL` | no | Defaults to `https://prayermessenger.com` |

Everything optional is genuinely optional: without the key the feature is
skipped, never errored.

## Sending the render-ready email

`RESEND_API_KEY` alone is not enough — Resend will refuse a `from` address
on a domain it has not verified. Add `prayermessenger.com` in the Resend
dashboard and publish the DNS records it gives you before expecting mail to
arrive. Until then the worker logs the refusal (status and body) and the
render completes normally.

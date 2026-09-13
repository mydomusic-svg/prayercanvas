// Sentry initialisation for the server and edge runtimes.
//
// WHY THIS EXISTS. A cartoon voice was renamed in the database before the
// code that understood the new name was deployed. The TTS call threw
// inside a deliberately best-effort try/catch — deliberate because an
// OpenAI outage must not stop someone saving a prayer — so nothing was
// written, nothing was logged anywhere anyone would look, and the failure
// surfaced minutes later and three steps downstream as "No audio found for
// this prayer". It was found only because someone happened to test the one
// character out of five that was broken.
//
// A swallowed exception is the right behaviour and an invisible exception
// is not. Everything caught-and-continued now reports here.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? "development",
      // The whole point is the errors. Traces cost quota and would eat the
      // free tier for no benefit we currently need.
      tracesSampleRate: 0,
      // Prayers are private and often about illness or grief. Never let a
      // request body or a transcript ride along with an error report.
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
        }
        return event;
      },
    });
  }
}

export const onRequestError = Sentry.captureRequestError;

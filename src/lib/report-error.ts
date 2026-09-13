import * as Sentry from "@sentry/nextjs";

/**
 * Reports an error that was caught and deliberately continued past.
 *
 * There are several places in this app where failing loudly would be worse
 * than failing quietly — if OpenAI is down, a prayer should still save;
 * the user can re-render later. Those catches are correct.
 *
 * What was not correct was that they left no trace anywhere anyone would
 * look. A cartoon voice renamed in the database ahead of the code that
 * understood it threw inside one of these, wrote nothing, and reappeared
 * minutes later as "No audio found for this prayer" — an error naming a
 * symptom three steps downstream of its cause. It survived a release, and
 * was found by chance.
 *
 * So: still swallowed, never silent. The console line stays for local
 * work, and Sentry gets it in production with enough tags to find it.
 *
 * Never pass a transcript, a recording, an email or any prayer text in
 * `context`. Prayers are private and frequently about illness or grief;
 * an error tracker is not the place for them. Identifiers only.
 */
export async function reportSwallowed(
  err: unknown,
  operation: string,
  context: Record<string, string | null | undefined> = {}
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${operation}] continuing past error: ${message}`, err);

  try {
    Sentry.captureException(err, {
      level: "warning", // degraded, not broken — the request still succeeds
      tags: { operation, swallowed: "true" },
      extra: context,
    });
    // Sentry's browser/node transports are fire-and-forget; in a serverless
    // function the process can be frozen the instant the response is sent,
    // which drops the event that was queued a millisecond earlier. Waiting
    // briefly is the difference between having these reports and not.
    await Sentry.flush(2000);
  } catch {
    // An error tracker that throws must never become the outage. If Sentry
    // is misconfigured or unreachable, the console line above still stands.
  }
}

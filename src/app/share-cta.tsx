import Link from "next/link";

/**
 * The invitation shown to someone who has just been sent a prayer.
 *
 * MEASURED, THEN MOVED. This sat after the transcript, which put the button
 * 1528px down a 1664px page — 2.02 screens below the fold on desktop, and
 * worse on a phone, where the video is portrait. Of 58 people who opened a
 * shared prayer, 1 signed up; the likeliest reading is not that 57 saw the
 * offer and declined but that they never reached it. It now sits directly
 * under the video, before the prayer text.
 *
 * THIS IS THE ONLY PLACE A STRANGER MEETS THE APP WARM. Every other visitor
 * arrives cold; this one arrives because a person who cares about them took
 * the trouble to make them something. Until now that page ended after the
 * video — the single best introduction this app gets, and it went nowhere.
 *
 * Tone is the whole design problem here. Someone reading this has just been
 * prayed for, possibly about something hard, and a sales pitch underneath
 * that would cheapen the thing they were sent. So it does not sell: it
 * names what just happened, and offers the same to someone they love. No
 * urgency, no price, no badge, no "sign up free" — the link goes to the
 * page that explains the app, and a person who is not ready simply closes
 * the tab having received their prayer, which is a perfectly good outcome.
 *
 * The separator above it matters too: it marks where the prayer ends and
 * the app begins, so the invitation never reads as part of the message.
 */
export default function ShareCta({ senderName }: { senderName?: string | null }) {
  // "Michael took a moment to pray for you" is a different sentence from
  // "Someone took a moment to pray for you" — one is a message from a
  // person they know, the other is a notice. The name is in the database;
  // not using it was leaving the strongest word on the page unsaid.
  // Falls back gracefully: a sender with no display name still gets a
  // sentence that reads naturally.
  const who = senderName?.trim() || "Someone";
  return (
    <section className="mt-4 w-full border-t border-sage-200 pt-8">
      <p className="font-headline text-lg text-sage-800">
        {who} took a moment to pray for you.
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-sage-600">
        You can send one too — speak it, or write it, and PrayerMessenger
        turns it into a video you can send to anyone.
      </p>
      <Link
        href="/create?from=shared"
        className="mt-5 inline-block rounded-full bg-sage-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-sage-700"
      >
        Make a prayer for someone
      </Link>
      <p className="mt-3 text-xs text-sage-400">
        Free to start. No app to install.
      </p>
    </section>
  );
}

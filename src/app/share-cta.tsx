import Link from "next/link";

/**
 * The invitation shown to someone who has just been sent a prayer.
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
export default function ShareCta() {
  return (
    <section className="mt-4 w-full border-t border-sage-200 pt-8">
      <p className="font-headline text-lg text-sage-800">
        Someone took a moment to pray for you.
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-sage-600">
        You can send one too — speak it, or write it, and PrayerMessenger
        turns it into a video you can send to anyone.
      </p>
      <Link
        href="/?from=shared"
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

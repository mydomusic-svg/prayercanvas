import type { Metadata } from "next";
import {
  FREE_VIDEOS_PER_MONTH,
  FREE_DOWNLOADS_PER_DAY,
  FREE_VIDEO_RETENTION_HOURS_COPY,
  SHARED_VIDEO_RETENTION_COPY,
} from "@/lib/plan-limits";
import { LegalPage, P, H2, UL, LI, LAST_UPDATED } from "../legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service · PrayerMessenger",
  description: "The agreement between you and PrayerMessenger.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={LAST_UPDATED}>
      <P>
        These terms apply when you use PrayerMessenger. Using the app means you
        accept them.
      </P>

      <H2>You must be 18 or older</H2>
      <P>
        Accounts are for adults. If you are making a prayer video for a child,
        that is exactly what the app is for — but the account must be yours.
      </P>

      <H2>What you make is yours</H2>
      <P>
        You keep ownership of your recordings, your words and your photos. You
        give us permission to store and process them only so far as is needed
        to run the app — transcribe the audio, render the video, and show it to
        whoever you send it to. We do not use your prayers to train models, and
        we do not publish them anywhere.
      </P>

      <H2>What the free plan includes</H2>
      <UL>
        <LI>{FREE_VIDEOS_PER_MONTH} prayer videos per calendar month.</LI>
        <LI>{FREE_DOWNLOADS_PER_DAY} downloads per day.</LI>
        <LI>
          A video you have not sent to anyone is deleted{" "}
          {FREE_VIDEO_RETENTION_HOURS_COPY} after it is made. Once shared, it
          is kept {SHARED_VIDEO_RETENTION_COPY}. The prayer stays in your
          account either way and can be rendered again.
        </LI>
      </UL>
      <P>
        These limits can change. If they get tighter, we will say so before it
        happens.
      </P>

      <H2>What you may not do</H2>
      <UL>
        <LI>
          Upload someone else&apos;s voice, likeness or photo without their
          permission.
        </LI>
        <LI>
          Use the app to harass, threaten, deceive or impersonate anyone.
        </LI>
        <LI>Upload anything unlawful, or anything sexual involving minors.</LI>
        <LI>
          Attempt to break, overload or circumvent the limits of the service.
        </LI>
      </UL>
      <P>
        We can suspend or remove an account that does these things. We do not
        routinely review the content of prayers — they are private by design —
        so this depends in part on reports.
      </P>

      <H2>Background music and video</H2>
      <P>
        The background clips and music are licensed for use inside
        PrayerMessenger videos. Full attribution is on the credits page. They
        are not yours to extract and reuse elsewhere.
      </P>

      <H2>The app is provided as it is</H2>
      <P>
        We work to keep it running and to keep your prayers safe, but we cannot
        promise the service will be uninterrupted or error-free, and we are not
        liable for loss arising from its use beyond what the law requires of
        us. Keep your own copy of anything you would be upset to lose.
      </P>

      <H2>Ending it</H2>
      <P>
        You can delete your account at any time from the account menu. We may
        close an account that breaks these terms.
      </P>

      <H2>Contact</H2>
      <P>
        <a className="underline" href="mailto:mydomusic@gmail.com">
          mydomusic@gmail.com
        </a>
      </P>
    </LegalPage>
  );
}

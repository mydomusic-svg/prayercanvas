import type { Metadata } from "next";
import {
  FREE_VIDEO_RETENTION_HOURS_COPY,
  SHARED_VIDEO_RETENTION_COPY,
} from "@/lib/plan-limits";
import { LegalPage, P, H2, UL, LI, LAST_UPDATED } from "../legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy · PrayerMessenger",
  description: "What PrayerMessenger collects, why, who it is shared with, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={LAST_UPDATED}>
      <P>
        PrayerMessenger turns a spoken prayer into a video you can send to
        someone. Doing that means handling a recording of your voice and the
        words you said, both of which are personal and often private. This
        page says plainly what happens to them.
      </P>

      <H2>Accounts are for adults</H2>
      <P>
        You must be 18 or older to create an account. PrayerMessenger is not
        directed to children and we do not knowingly collect personal
        information from anyone under 13. The cartoon voices exist so that a
        video an adult makes is enjoyable for a child to <em>watch</em> — not
        so that children sign up. If you believe a child has created an
        account, contact us and we will delete it.
      </P>

      <H2>What we collect</H2>
      <UL>
        <LI>
          <strong>Your email address and password.</strong> Used to sign you in
          and to reach you about your account. Passwords are stored hashed by
          our authentication provider; we never see them.
        </LI>
        <LI>
          <strong>Your voice recording.</strong> When you record a prayer, the
          audio is uploaded so it can be transcribed and turned into a video.
        </LI>
        <LI>
          <strong>The transcript and the title and theme detected from it.</strong>{" "}
          The words of your prayer, in text.
        </LI>
        <LI>
          <strong>Photos you upload</strong> to use as a video background.
        </LI>
        <LI>
          <strong>The finished video</strong> and its thumbnail.
        </LI>
        <LI>
          <strong>Anything you write in the Bible section</strong> — notes,
          highlights and bookmarks.
        </LI>
        <LI>
          <strong>A record of how many videos you have made and downloaded,</strong>{" "}
          so free-plan limits can be enforced.
        </LI>
      </UL>
      <P>
        We do not run advertising, we do not sell personal information, and we
        do not build advertising profiles.
      </P>

      <H2>Who else processes it</H2>
      <P>
        We use a small number of service providers to make the app work. Each
        receives only what it needs to do its job.
      </P>
      <UL>
        <LI>
          <strong>Supabase</strong> — stores the database, the files, and
          handles sign-in.
        </LI>
        <LI>
          <strong>Vercel</strong> — hosts the website.
        </LI>
        <LI>
          <strong>Railway</strong> — runs the service that renders your video.
        </LI>
        <LI>
          <strong>OpenAI</strong> — receives your voice recording to transcribe
          it, and receives the transcript to read it aloud in a chosen voice.
        </LI>
        <LI>
          <strong>Anthropic</strong> — receives the transcript to suggest a
          title and theme for your prayer.
        </LI>
      </UL>
      <P>
        Your recording and transcript leave our systems to reach OpenAI and
        Anthropic. That is unavoidable for the feature to work, and it is worth
        knowing before you record something you would not want processed by a
        third party.
      </P>

      <H2>Links you share are public to whoever holds them</H2>
      <P>
        When you send a prayer, we create a link containing a hard-to-guess
        token. Anyone who has that link can watch the video without signing in
        — that is the point of it, but it means a link forwarded onward stays
        open to whoever receives it. Treat a share link the way you would treat
        the video itself.
      </P>

      <H2>How long we keep things</H2>
      <UL>
        <LI>
          On the free plan, a video you have <strong>not</strong> sent to
          anyone is deleted {FREE_VIDEO_RETENTION_HOURS_COPY} after it is
          made. Once you send a prayer, its video is kept for{" "}
          {SHARED_VIDEO_RETENTION_COPY} so the person you sent it to can
          still watch it. Either way the prayer itself stays in your account
          and can be made into a video again.
        </LI>
        <LI>Share links expire.</LI>
        <LI>
          Everything else is kept until you delete the prayer or your account.
        </LI>
      </UL>

      <H2>Deleting your data</H2>
      <P>
        You can delete an individual prayer from its page, and your entire
        account from the account menu. Deleting your account removes your
        prayers, recordings, photos, videos and notes. Some records may persist
        briefly in backups before being overwritten.
      </P>

      <H2>Security</H2>
      <P>
        Data is encrypted in transit. Access to your prayers is restricted to
        your account at the database level. No system is perfectly secure, and
        we will not pretend otherwise.
      </P>

      <H2>Changes</H2>
      <P>
        If this policy changes in a way that materially affects you, we will
        say so in the app rather than quietly editing this page.
      </P>

      <H2>Contact</H2>
      <P>
        Questions, or a request to delete something, go to{" "}
        <a className="underline" href="mailto:mydomusic@gmail.com">
          mydomusic@gmail.com
        </a>
        .
      </P>
    </LegalPage>
  );
}

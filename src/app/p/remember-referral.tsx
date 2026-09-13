"use client";

import { useEffect } from "react";

/**
 * Remembers which share link someone arrived through, so that if they go on
 * to sign up we can tell whether the share loop actually converts.
 *
 * Renders nothing. It exists as a client component because the share page
 * is a Server Component, and a Server Component cannot set a cookie during
 * render in the App Router — only a Route Handler, Server Action or
 * middleware can. A three-line effect is a smaller thing to add than a
 * middleware matcher.
 *
 * WHAT THIS IS NOT. Not a tracking pixel and not a third-party script. The
 * cookie is first-party, holds a share token this person was just given by
 * someone they know, and is read exactly once — at signup, by this app. It
 * is not sent anywhere, not joined to anything, and expires in 30 days.
 * That matters here specifically: the privacy policy published this week
 * names every processor that receives data, and the point of doing it this
 * way is that the list does not grow.
 *
 * SameSite=Lax so it survives the click from Messages or WhatsApp into the
 * browser, which is the entire journey being measured.
 */
export default function RememberReferral({ token }: { token: string }) {
  useEffect(() => {
    // Never overwrite an earlier referral. If someone was sent two prayers,
    // the first one is the one that brought them here.
    if (document.cookie.split("; ").some((c) => c.startsWith("pm_ref="))) {
      return;
    }
    const thirtyDays = 30 * 24 * 60 * 60;
    document.cookie =
      `pm_ref=${encodeURIComponent(token)}; path=/; max-age=${thirtyDays}; ` +
      `SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }, [token]);

  return null;
}

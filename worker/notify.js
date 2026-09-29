// Tells someone their prayer video is ready.
//
// WHY THIS EXISTS. The prayer page polls while you are looking at it, so
// anyone who waits sees the render finish. Anyone who switches tabs gets
// nothing at all — no email, no notification, nothing. For a product whose
// entire value is SENDING the thing, a finished prayer nobody comes back
// to collect is a prayer never sent, and until now that was a silent,
// invisible loss.
//
// Sent from the worker rather than the app because the worker is the only
// thing that knows a render finished. Plain fetch against Resend's HTTP
// API rather than their SDK: one POST does not justify another dependency
// in the render image.
//
// BEST-EFFORT, ALWAYS. A mail failure must never fail a render that
// actually succeeded — the video exists and is on the prayer page either
// way. Every path here swallows its error and logs it.
//
// Inert without RESEND_API_KEY, exactly like Sentry, so local runs and
// anyone else's fork behave as before rather than erroring on a missing
// key.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Falls back to the production host so a misconfigured worker sends a
// working link rather than a broken one.
const APP_URL = (process.env.APP_URL || "https://prayermessenger.com").replace(/\/$/, "");
const MAIL_FROM = process.env.MAIL_FROM || "PrayerMessenger <prayers@prayermessenger.com>";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/**
 * @param supabase  service-role client
 * @param prayer    { id, user_id, title, recipient_name, include_recipient_in_title }
 * @param thumbnailUrl public URL of the poster frame, or null
 */
export async function sendRenderReadyEmail(supabase, prayer, thumbnailUrl) {
  if (!process.env.RESEND_API_KEY) return;

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("email, display_name")
      .eq("id", prayer.user_id)
      .maybeSingle();
    if (error || !user?.email) return;

    const title =
      prayer.title ||
      (prayer.include_recipient_in_title && prayer.recipient_name
        ? `A Prayer for ${prayer.recipient_name}`
        : "Your prayer");

    const link = `${APP_URL}/prayers/${prayer.id}`;
    const firstName = (user.display_name || "").trim().split(/\s+/)[0];

    // Deliberately short, and deliberately not a newsletter. One thing has
    // happened and there is one thing to do about it. No marketing, no
    // footer of links, no unsubscribe pitch — this is a transactional note
    // about something they asked for a minute ago.
    const html = `
<div style="font-family:Georgia,'Times New Roman',serif;max-width:480px;margin:0 auto;padding:24px;color:#2c3a30">
  <p style="font-size:17px;margin:0 0 16px">${firstName ? `${escapeHtml(firstName)}, your` : "Your"} prayer video is ready.</p>
  <p style="font-size:15px;color:#55655b;margin:0 0 20px">${escapeHtml(title)}</p>
  ${
    thumbnailUrl
      ? `<a href="${link}"><img src="${thumbnailUrl}" alt="" width="240" style="width:240px;max-width:100%;border-radius:12px;display:block;margin:0 0 20px"></a>`
      : ""
  }
  <a href="${link}" style="display:inline-block;background:#4f6f56;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px;font-family:system-ui,sans-serif">Watch and send it</a>
  <p style="font-size:12px;color:#8d9a92;margin:24px 0 0;font-family:system-ui,sans-serif">
    You're getting this because you made a prayer on PrayerMessenger.
  </p>
</div>`.trim();

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [user.email],
        subject: `${title} is ready to send`,
        html,
      }),
    });

    if (!res.ok) {
      // Body, not just status — Resend explains refusals (unverified
      // domain, invalid from-address) in it, and the status alone sends you
      // looking in the wrong place.
      console.error(
        `Render-ready email failed (${res.status}): ${(await res.text()).slice(0, 300)}`
      );
      return;
    }
    console.log(`Render-ready email sent for prayer ${prayer.id}`);
  } catch (err) {
    console.error(`Render-ready email failed: ${err.message}`);
  }
}

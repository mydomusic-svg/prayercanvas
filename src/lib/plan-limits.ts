/**
 * The free plan's limits, in one place.
 *
 * These numbers were written out by hand in four separate bits of copy and
 * once more in the database, which is how a pricing page ends up promising
 * one thing while the product enforces another — exactly what happened with
 * the monthly cap, advertised for months and never enforced at all.
 *
 * ONE EXCEPTION THAT CANNOT BE IMPORTED: enforce_prayer_quota() in
 * 0027_prayer_quota.sql holds its own copy of the monthly limit, because a
 * Postgres trigger cannot read a TypeScript constant. Change one, change the
 * other — both carry a comment pointing here.
 */
export const FREE_VIDEOS_PER_MONTH = 6;
export const FREE_DOWNLOADS_PER_DAY = 3;

/**
 * How long a free-tier video stays online after rendering.
 *
 * THIS WAS WRONG AND SAID 7 DAYS. The worker deletes at
 * FREE_VIDEO_RETENTION_HOURS, which defaults to 24 — so the pricing page
 * promised a week while the sweep took the file after a day. Nobody had
 * complained yet, which is the only reason it survived: the people it hurt
 * would have gone looking for a video on day three and found nothing, with
 * no error and no explanation.
 *
 * Set to 24 hours rather than fixing the worker to 168, deliberately. The
 * project is over its storage quota and faces restriction; honouring a
 * 7-day promise would multiply stored video roughly sevenfold at exactly
 * the wrong moment. A smaller honest promise beats a generous broken one.
 *
 * The number is expressed in hours because that is the unit the worker
 * actually uses. Two constants, one for arithmetic and one for prose, so
 * the copy cannot drift from the value the way "7 days" did.
 */
export const FREE_VIDEO_RETENTION_HOURS = 24;
export const FREE_VIDEO_RETENTION_HOURS_COPY = "24 hours";

/**
 * How long a free-tier video stays online once the prayer has been SHARED.
 *
 * Mirrors SHARED_VIDEO_RETENTION_HOURS in the worker. The asymmetry is
 * deliberate: an unshared video is pure storage cost, while a shared one is
 * the only thing the recipient of a link actually came to see. At a flat 24
 * hours a prayer sent on Friday and opened on Sunday showed the recipient a
 * notice instead of a video — the app quietly failing at the exact moment a
 * stranger met it.
 *
 * Bounded at 30 days rather than tied to the share link, because share
 * links have no expiry: "as long as the link" would mean forever and move
 * the storage problem rather than solve it.
 */
export const SHARED_VIDEO_RETENTION_DAYS = 30;
export const SHARED_VIDEO_RETENTION_COPY = "30 days";

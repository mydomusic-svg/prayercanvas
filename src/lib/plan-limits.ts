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
 * Mirrors FREE_VIDEO_RETENTION_HOURS in the worker, which is a Railway
 * environment variable so it can be changed without a redeploy. This value
 * is only what the pricing page tells people, so if you change it there,
 * change it here.
 */
export const FREE_VIDEO_RETENTION_DAYS = 7;

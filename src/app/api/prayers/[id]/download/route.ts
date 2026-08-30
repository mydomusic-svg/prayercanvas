import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Spends one of a free-plan user's daily downloads, or reports that they
 * have run out. Paid plans are unlimited.
 *
 * The count is a rolling 24-hour window rather than a calendar day: a
 * midnight reset is trivially gamed by just waiting for midnight, and it
 * also punishes whoever happens to be using the app at 11pm.
 *
 * GET  — how many are left, without spending one (used to render the UI).
 * POST — spend one, returning whether it was allowed.
 *
 * The insert is done with the service-role client on purpose. The RLS
 * policy in 0016 deliberately does NOT let the browser write its own usage
 * rows: a client that can record its own downloads can also quietly not
 * record them.
 *
 * NOTE ON HOW HARD THIS LIMIT IS: rendered videos currently live at public
 * Storage URLs, so this gates the app's download button, not the file
 * itself — someone who copies the URL can still fetch it. Making the cap
 * airtight means moving renders to a private bucket behind short-lived
 * signed URLs, which also touches the worker's upload, the player, and the
 * public share pages. Worth doing if the cap ever starts mattering
 * commercially; not worth blocking it on today.
 */

const FREE_DOWNLOADS_PER_DAY = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

async function getUsage(userId: string) {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("users")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();

  // Anything other than an explicit "free" counts as paid — same fail-safe
  // direction the worker's retention sweep uses. If we cannot tell, do not
  // take something away from someone who may be paying.
  const isPaid = Boolean(profile?.plan && profile.plan !== "free");
  if (isPaid) {
    return { isPaid, used: 0, remaining: Infinity, limit: Infinity };
  }

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { count } = await admin
    .from("prayer_downloads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  const used = count ?? 0;
  return {
    isPaid,
    used,
    remaining: Math.max(0, FREE_DOWNLOADS_PER_DAY - used),
    limit: FREE_DOWNLOADS_PER_DAY,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const usage = await getUsage(user.id);
  return NextResponse.json({
    allowed: usage.isPaid || usage.remaining > 0,
    unlimited: usage.isPaid,
    remaining: usage.isPaid ? null : usage.remaining,
    limit: usage.isPaid ? null : usage.limit,
  });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const usage = await getUsage(user.id);

  if (!usage.isPaid && usage.remaining <= 0) {
    return NextResponse.json(
      {
        allowed: false,
        unlimited: false,
        remaining: 0,
        limit: usage.limit,
        error: "daily_download_limit",
      },
      { status: 429 }
    );
  }

  if (!usage.isPaid) {
    const admin = createAdminClient();
    const { error } = await admin.from("prayer_downloads").insert({
      user_id: user.id,
      prayer_id: id,
    });
    // If the usage row fails to write, let the download proceed anyway —
    // a miscounted download is a far smaller problem than blocking someone
    // from their own prayer because of a transient database error.
    if (error) {
      console.error("Failed to record download:", error.message);
    }
  }

  return NextResponse.json({
    allowed: true,
    unlimited: usage.isPaid,
    remaining: usage.isPaid ? null : Math.max(0, usage.remaining - 1),
    limit: usage.isPaid ? null : usage.limit,
  });
}

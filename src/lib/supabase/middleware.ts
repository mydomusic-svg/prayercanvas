import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request so server-rendered
 * pages always see an up-to-date user. Wired up in middleware.ts.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session if expired — required for Server Components.
  // Network transitions (e.g. right after a phone unlocks and reconnects to
  // WiFi/cellular) can make this call fail transiently. Letting that throw
  // would turn a recoverable hiccup into a hard 500 for the whole request;
  // swallowing it here just means this particular request falls back to
  // whatever session state the existing cookies already represent, instead
  // of forcing a sign-out because one refresh attempt didn't get a response.
  try {
    await supabase.auth.getUser();
  } catch (err) {
    console.error("Supabase session refresh failed in middleware:", err);
  }

  return supabaseResponse;
}

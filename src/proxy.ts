import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { sessionCookieOptions } from "@/lib/supabase/sessionCookie";

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * IMPORTANT: this middleware does NOT authorise anything. It only keeps the
 * session valid. Route handlers call requireUser(), and real access control
 * lives in Postgres (RLS + RPCs). If this file were deleted, pages would fail
 * to see a logged-in user — they would never fail OPEN.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Tolerant read (no throw): this runs on every request, and a missing key
  // here must degrade to "no session refresh", never a 500. Accepts both the
  // legacy ANON_KEY name and the newer PUBLISHABLE_KEY name.
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, { ...options, ...sessionCookieOptions() })
          );
        },
      },
    });

    // Validates the JWT server-side and rotates expiring tokens.
    await supabase.auth.getUser();
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

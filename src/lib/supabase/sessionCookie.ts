import type { CookieOptions } from "@supabase/ssr";

/**
 * Hardened attributes for the Supabase session cookie, applied at EVERY write
 * site (login via the server client, and the proxy on each request's refresh).
 * The library's defaults are overridden, not merged by accident:
 *
 * - httpOnly: JavaScript cannot read the cookie, so an XSS bug cannot exfiltrate
 *   the access/refresh token (the cookie value contains the refresh token and
 *   outlives the access token by design). Safe here because no client component
 *   talks to Supabase directly — every flow goes through our API routes, which
 *   read the cookie server-side.
 * - secure: only sent over HTTPS. Production is HTTPS-only (Vercel); localhost
 *   dev is plain http, so the flag follows NODE_ENV.
 * - sameSite=lax: a cross-site form POST arrives WITHOUT the cookie (classic
 *   CSRF), while normal top-level navigation still works. Our state-changing
 *   routes additionally expect JSON, which cross-origin forms cannot send.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

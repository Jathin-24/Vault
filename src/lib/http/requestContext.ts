/**
 * Request context helpers: client IP, user agent, and same-origin checking
 * for state-changing routes.
 */

export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && /^[\d.:%a-fA-F-]{1,45}$/.test(first)) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real && /^[\d.:%a-fA-F-]{1,45}$/.test(real)) return real;
  return null;
}

export function getUserAgent(request: Request): string | null {
  const ua = request.headers.get("user-agent");
  return ua ? ua.slice(0, 300) : null;
}

/**
 * CSRF hardening for mutations: browsers attach Origin to cross-site
 * POST/PATCH/DELETE. SameSite=Lax cookies already block those; this is the
 * second layer. Requests without Origin (curl, server-to-server) pass —
 * they carry no ambient authority beyond the cookie itself.
 */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return true; // not configured (local dev on any host)
  const normalise = (u: string) => u.replace(/\/+$/, "").toLowerCase();
  return normalise(origin) === normalise(appUrl);
}

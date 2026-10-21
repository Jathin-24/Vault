import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  checkPasswordStrength,
  isPlausibleEmail,
} from "@/lib/auth/passwordPolicy";
import { logServerEvent } from "@/lib/audit/logServerEvent";
import {
  badRequest,
  handleRouteError,
  tooManyRequests,
} from "@/lib/http/apiError";
import { getClientIp, getUserAgent } from "@/lib/http/requestContext";

export const runtime = "nodejs";

/**
 * POST /api/auth/signup
 * who may call: anyone (pre-authentication)
 *
 * Server-side gate: password policy is enforced HERE (client checks are UX
 * only), signup is rate-limited per IP, and responses are uniform to prevent
 * account enumeration.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);
    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const fullName = String(body?.fullName ?? "").trim().slice(0, 120);

    if (!isPlausibleEmail(email)) {
      return badRequest("Enter a valid email address.");
    }

    const strength = checkPasswordStrength(password, email);
    if (!strength.ok) {
      return badRequest(strength.problems.join(" "));
    }

    const admin = getAdminSupabase();
    const allowed = await admin.rpc("tv_rate_limit_take", {
      p_key: `signup:${ip ?? "unknown"}`,
      p_max: 10,
      p_window_seconds: 3600,
    });
    if (allowed.data === false) {
      return tooManyRequests("Too many signup attempts. Try again later.");
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // email verification stays ON: grants to an email
      // activate only for the verified owner of that mailbox.
      user_metadata: { full_name: fullName },
    });

    if (error) {
      const duplicate =
        error.message.toLowerCase().includes("already") ||
        error.code === "email_exists";
      await logServerEvent({
        eventType: duplicate ? "auth.signup_duplicate" : "auth.signup_failed",
        targetEmail: email,
        route: "/api/auth/signup",
        outcome: "denied",
        metadata: { reason: error.message.slice(0, 200) },
        ip,
        userAgent: ua,
      });
      if (duplicate) {
        // Uniform response: the client cannot tell "exists" from "created".
        return NextResponse.json({ ok: true });
      }
      return badRequest("Could not create the account.");
    }

    await logServerEvent({
      eventType: "auth.signup",
      targetEmail: email,
      route: "/api/auth/signup",
      outcome: "success",
      metadata: { user_id: data.user?.id, full_name: fullName },
      ip,
      userAgent: ua,
      actorUserId: data.user?.id ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, "POST /api/auth/signup");
  }
}

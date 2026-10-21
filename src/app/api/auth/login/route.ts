import { NextResponse, type NextRequest } from "next/server";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { logServerEvent } from "@/lib/audit/logServerEvent";
import {
  badRequest,
  handleRouteError,
  tooManyRequests,
} from "@/lib/http/apiError";
import { getClientIp, getUserAgent } from "@/lib/http/requestContext";

export const runtime = "nodejs";

/**
 * POST /api/auth/login
 * who may call: anyone (pre-authentication)
 *
 * Proxied through our server so every attempt — success and failure — is
 * rate-limited AND recorded (failed logins are evidence). Responses are
 * uniform: "Invalid email or password" for every failure mode.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ua = getUserAgent(request);
    const body = await request.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");

    if (!email || !password) {
      return badRequest("Email and password are required.");
    }

    const admin = getAdminSupabase();

    // Two limits: per-IP noise control, and per-IP+email targeted guessing.
    const ipOk = await admin.rpc("tv_rate_limit_take", {
      p_key: `login-ip:${ip ?? "unknown"}`,
      p_max: 30,
      p_window_seconds: 300,
    });
    const targetedOk = await admin.rpc("tv_rate_limit_take", {
      p_key: `login-target:${ip ?? "unknown"}:${email}`,
      p_max: 5,
      p_window_seconds: 300,
    });
    if (ipOk.data === false || targetedOk.data === false) {
      return tooManyRequests("Too many login attempts. Try again shortly.");
    }

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      await logServerEvent({
        eventType: "auth.login_failed",
        targetEmail: email,
        route: "/api/auth/login",
        outcome: "denied",
        metadata: { reason: error?.message.slice(0, 200) ?? "unknown" },
        ip,
        userAgent: ua,
      }).catch(() => undefined); // never reveal audit trouble to the client
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Deactivated accounts cannot even establish a session: the leaver case.
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active, platform_role, full_name")
      .eq("id", data.user.id)
      .single();

    if (!profile?.is_active) {
      await supabase.auth.signOut();
      await logServerEvent({
        eventType: "auth.login_failed",
        targetEmail: email,
        route: "/api/auth/login",
        outcome: "denied",
        metadata: { reason: "user_inactive" },
        ip,
        userAgent: ua,
        actorUserId: data.user.id,
      });
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    await logServerEvent({
      eventType: "auth.login",
      targetEmail: email,
      route: "/api/auth/login",
      outcome: "success",
      metadata: { platform_role: profile.platform_role },
      ip,
      userAgent: ua,
      actorUserId: data.user.id,
    });

    return NextResponse.json({
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: profile.full_name,
        platformRole: profile.platform_role,
      },
    });
  } catch (err) {
    return handleRouteError(err, "POST /api/auth/login");
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { logServerEvent } from "@/lib/audit/logServerEvent";
import { handleRouteError } from "@/lib/http/apiError";
import { getClientIp, getUserAgent } from "@/lib/http/requestContext";

export const runtime = "nodejs";

/**
 * POST /api/auth/logout
 * who may call: any authenticated user (401 otherwise)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      await logServerEvent({
        eventType: "auth.logout",
        targetEmail: user.email ?? null,
        route: "/api/auth/logout",
        actorUserId: user.id,
        ip: getClientIp(request),
        userAgent: getUserAgent(request),
      }).catch(() => undefined);
    }

    await supabase.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, "POST /api/auth/logout");
  }
}

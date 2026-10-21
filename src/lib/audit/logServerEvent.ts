import { getAdminSupabase } from "@/lib/supabase/admin";

/**
 * Server-side audit writer for events that happen in route handlers where the
 * user's JWT is not the caller (login, signup, logout, admin actions using the
 * service role). Actor identity is passed explicitly — it was verified from
 * the session by the calling route, and tv_log_event only accepts this
 * parameter from service_role.
 *
 * critical=true → an audit failure fails the operation. Used where the product
 * promise is "prove who reached it": no record, no access.
 */
export interface ServerAuditEvent {
  eventType: string;
  documentId?: string | null;
  targetEmail?: string | null;
  route?: string | null;
  outcome?: "success" | "denied" | "error";
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  actorUserId?: string | null;
}

export async function logServerEvent(
  event: ServerAuditEvent,
  options: { critical?: boolean } = {}
): Promise<void> {
  try {
    const admin = getAdminSupabase();
    const { error } = await admin.rpc("tv_log_event", {
      p_event_type: event.eventType,
      p_document_id: event.documentId ?? null,
      p_target_email: event.targetEmail ?? null,
      p_route: event.route ?? null,
      p_outcome: event.outcome ?? "success",
      p_metadata: (event.metadata as Record<string, never>) ?? {},
      p_ip: event.ip ?? null,
      p_user_agent: event.userAgent ?? null,
      p_actor_user_id: event.actorUserId ?? null,
    });
    if (error) throw new Error(`tv_log_event: ${error.message}`);
  } catch (err) {
    console.error("[audit] write failed:", err);
    if (options.critical) throw err;
  }
}

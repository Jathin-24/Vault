import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireUser } from "@/lib/auth/requireUser";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { logServerEvent } from "@/lib/audit/logServerEvent";
import { validateUpload } from "@/lib/documents/validateUpload";
import { buildStoragePath } from "@/lib/documents/buildStoragePath";
import {
  badRequest,
  handleRouteError,
  notFound,
  tooManyRequests,
} from "@/lib/http/apiError";
import { isSameOriginMutation } from "@/lib/http/requestContext";
import { bestEffort } from "@/lib/http/bestEffort";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/documents/:id/versions — upload a new version (multipart: file)
 * who may call: owner, or grantee with 'edit'. NOT admins (content writes are
 * not an admin capability — see roles table).
 *
 * Order of operations is the security story:
 *   authenticate → authorise 'edit' (audited, fail closed) → validate bytes →
 *   store object under a server-generated key → insert version row (RLS
 *   re-checks 'edit' + path-prefix CHECK) → bump current_version → audit.
 * Any failure unwinds stored bytes: no orphan objects, no half-versions.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  let storagePath: string | null = null;
  let insertedVersionId: string | null = null;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return notFound();
    if (!isSameOriginMutation(request)) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }

    const ctx = await requireUser();
    if ("error" in ctx) return ctx.error;
    const { supabase, user } = ctx;

    // Cheap size guard before buffering anything.
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
      return NextResponse.json({ error: "File too large." }, { status: 413 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return badRequest("Attach the file in the 'file' field.");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const validation = validateUpload({
      filename: file.name,
      declaredMime: file.type,
      bytes,
    });
    if (!validation.ok) {
      return NextResponse.json(
        { error: "Upload rejected.", details: validation.errors },
        { status: 400 }
      );
    }

    // ── authorise 'edit' NOW (audited, fail closed) ────────────────────────
    const { data: decision, error: decisionError } = await supabase.rpc(
      "tv_authorize_document_access",
      {
        p_document_id: id,
        p_action: "edit",
        p_route: "/api/documents/:id/versions",
        p_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        p_user_agent: request.headers.get("user-agent"),
      }
    );
    if (decisionError) throw new Error(`authorization failed closed: ${decisionError.message}`);
    if (!decision?.allowed) {
      return decision?.reason === "grant_insufficient" || decision?.reason === "user_inactive"
        ? NextResponse.json({ error: "Not permitted." }, { status: 403 })
        : notFound();
    }

    const { data: doc } = await supabase
      .from("documents")
      .select("id, status, current_version, owner_id")
      .eq("id", id)
      .maybeSingle();
    if (!doc) return notFound();
    if (doc.status !== "active") return badRequest("Document is deleted.");

    const rateOk = await getAdminSupabase().rpc("tv_rate_limit_take", {
      p_key: `upload:${user.id}`,
      p_max: 60,
      p_window_seconds: 300,
    });
    if (rateOk.data === false) return tooManyRequests("Too many uploads. Slow down.");

    const nextVersion = (doc.current_version ?? 0) + 1;
    storagePath = buildStoragePath(id, nextVersion, validation.extension);
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    // ── store bytes (service role only touches storage) ────────────────────
    const admin = getAdminSupabase();
    const { error: uploadError } = await admin.storage
      .from("documents")
      .upload(storagePath, bytes, {
        contentType: validation.mimeType,
        upsert: false,
        cacheControl: "0",
      });
    if (uploadError) throw new Error(`storage upload: ${uploadError.message}`);

    // ── record version (RLS re-checks 'edit'; CHECK pins path to document) ─
    const { data: versionRow, error: insertError } = await supabase
      .from("document_versions")
      .insert({
        document_id: id,
        version_no: nextVersion,
        original_filename: validation.filename,
        storage_path: storagePath,
        mime_type: validation.mimeType,
        extension: validation.extension,
        size_bytes: validation.sizeBytes,
        content_hash: contentHash,
        uploaded_by: user.id,
      })
      .select("id, version_no")
      .single();

    if (insertError) {
      await bestEffort(
        admin.storage.from("documents").remove([storagePath]),
        "remove orphan object"
      );
      storagePath = null;
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Another version was uploaded at the same moment. Retry." },
          { status: 409 }
        );
      }
      if (insertError.code === "42501" || /row-level security|not permitted/i.test(insertError.message)) {
        return NextResponse.json(
          { error: "Your access changed during upload." },
          { status: 403 }
        );
      }
      throw insertError;
    }
    insertedVersionId = versionRow.id;

    // ── publish it (RLS again; a revocation between steps is honoured) ─────
    const { data: bumped, error: bumpError } = await supabase
      .from("documents")
      .update({ current_version: nextVersion })
      .eq("id", id)
      .select("id");

    if (bumpError || !bumped?.length) {
      await bestEffort(
        admin.storage.from("documents").remove([storagePath]),
        "remove object after failed publish"
      );
      await bestEffort(
        admin.from("document_versions").delete().eq("id", insertedVersionId),
        "remove version row after failed publish"
      );
      storagePath = null;
      insertedVersionId = null;
      return NextResponse.json(
        { error: "Your access changed during upload." },
        { status: 403 }
      );
    }

    // ── audit: critical — no record, no document ───────────────────────────
    try {
      await logServerEvent(
        {
          eventType: "document.upload",
          documentId: id,
          route: "/api/documents/:id/versions",
          outcome: "success",
          metadata: {
            version_no: nextVersion,
            filename: validation.filename,
            size_bytes: validation.sizeBytes,
            mime_type: validation.mimeType,
            content_hash: contentHash,
          },
          actorUserId: user.id,
        },
        { critical: true }
      );
    } catch (auditErr) {
      // Unwind: the file must not exist without a proof-of-who-put-it-there.
      await bestEffort(
        admin.storage.from("documents").remove([storagePath]),
        "remove object after audit failure"
      );
      await bestEffort(
        admin.from("document_versions").delete().eq("id", insertedVersionId),
        "remove version row after audit failure"
      );
      await bestEffort(
        admin
          .from("documents")
          .update({ current_version: doc.current_version })
          .eq("id", id),
        "revert current_version after audit failure"
      );
      throw auditErr;
    }

    return NextResponse.json(
      {
        version: {
          id: versionRow.id,
          version_no: nextVersion,
          original_filename: validation.filename,
          size_bytes: validation.sizeBytes,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleRouteError(err, "POST /api/documents/:id/versions");
  }
}

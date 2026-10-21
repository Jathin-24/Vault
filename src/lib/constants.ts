/**
 * Shared constants. Anything the API validates against lives here so the UI
 * and the server cannot drift apart.
 */

export const DOCUMENT_PERMISSIONS = ["read", "edit"] as const;
export type DocumentPermission = (typeof DOCUMENT_PERMISSIONS)[number];

export const PLATFORM_ROLES = ["user", "admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const DOCUMENT_STATUSES = ["active", "deleted"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Upload allowlist: extension -> accepted mime types (validated server-side). */
export const ALLOWED_UPLOADS: Record<string, readonly string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  txt: ["text/plain"],
  md: ["text/markdown"],
  csv: ["text/csv"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
};

export const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024
);

export const RETENTION_DAYS_BEFORE_PURGE = 30;

export const CATEGORIES = [
  "general",
  "contract",
  "finance",
  "hr",
  "audit",
  "drawing",
  "legal",
  "regulatory",
  "other",
] as const;

/** Event types the admin console badges specially. */
export const SECURITY_EVENT_TYPES = [
  "access_denied",
  "auth.login_failed",
  "admin_override",
  "grant.revoke",
  "grant.create",
] as const;

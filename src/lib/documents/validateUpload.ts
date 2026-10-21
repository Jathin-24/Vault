import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES } from "@/lib/constants";
import {
  extensionOf,
  sanitizeFilename,
} from "@/lib/documents/sanitizeFilename";

/**
 * Server-side upload validation. Everything about the client is a lie until
 * proven otherwise: extension, declared MIME type and filename are all
 * attacker-controlled, so the CONTENT decides what this file is.
 *
 * Layers:
 *   1. sanitised filename + allowlisted extension
 *   2. size cap
 *   3. magic-byte sniffing (signature must match the extension's family)
 *   4. declared-MIME cross-check (dangerous types always rejected)
 *   5. OOXML containers must actually contain [Content_Types].xml
 *   6. plain text must be UTF-8-ish with no NUL bytes
 */

export interface UploadValidation {
  ok: boolean;
  errors: string[];
  filename: string;
  extension: string;
  /** Canonical mime we STORE — derived from the allowlist, not from the client. */
  mimeType: string;
  sizeBytes: number;
}

type SniffResult =
  | "pdf"
  | "png"
  | "jpeg"
  | "webp"
  | "ooxml"
  | "text"
  | "unknown";

const EXT_FAMILY: Record<string, SniffResult> = {
  pdf: "pdf",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
  txt: "text",
  md: "text",
  csv: "text",
  docx: "ooxml",
  xlsx: "ooxml",
  pptx: "ooxml",
};

const DANGEROUS_DECLARED = [
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-shockwave-flash",
];

function startsWith(bytes: Buffer, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function asciiAt(bytes: Buffer, text: string, offset = 0): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function sniffContent(bytes: Buffer): SniffResult {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (asciiAt(bytes, "RIFF") && asciiAt(bytes, "WEBP", 8)) return "webp";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP container: real OOXML carries [Content_Types].xml near the front.
    const head = bytes.subarray(0, Math.min(bytes.length, 65536)).toString("latin1");
    return head.includes("[Content_Types].xml") ? "ooxml" : "unknown";
  }
  // Text heuristic: no NUL bytes, valid UTF-8.
  if (bytes.length === 0) return "unknown";
  if (bytes.includes(0x00)) return "unknown";
  const decoded = new TextDecoder("utf-8", { fatal: true });
  try {
    decoded.decode(bytes);
    return "text";
  } catch {
    return "unknown";
  }
}

export function validateUpload(input: {
  filename: string;
  declaredMime: string;
  bytes: Buffer;
}): UploadValidation {
  const errors: string[] = [];

  const filename = sanitizeFilename(input.filename);
  const extension = extensionOf(filename) ?? "";
  const declared = (input.declaredMime ?? "").split(";")[0].trim().toLowerCase();

  if (!extension || !(extension in ALLOWED_UPLOADS)) {
    errors.push(
      `File type "${extension || "unknown"}" is not allowed. Allowed: ${Object.keys(
        ALLOWED_UPLOADS
      ).join(", ")}.`
    );
  }

  if (input.bytes.length === 0) {
    errors.push("File is empty.");
  }
  if (input.bytes.length > MAX_UPLOAD_BYTES) {
    errors.push(
      `File is larger than the ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`
    );
  }

  // Declared type: dangerous never passes, regardless of content.
  if (declared && DANGEROUS_DECLARED.includes(declared)) {
    errors.push(`Content type "${declared}" is not allowed.`);
  }

  const sniffed = sniffContent(input.bytes);

  if (errors.length === 0 && extension in EXT_FAMILY) {
    const expected = EXT_FAMILY[extension];
    if (sniffed !== expected) {
      errors.push(
        `File content (${sniffed}) does not match its extension ".${extension}".`
      );
    }
  }

  const canonicalMime =
    extension in ALLOWED_UPLOADS
      ? ALLOWED_UPLOADS[extension][0]
      : "application/octet-stream";

  return {
    ok: errors.length === 0,
    errors,
    filename,
    extension,
    mimeType: canonicalMime,
    sizeBytes: input.bytes.length,
  };
}

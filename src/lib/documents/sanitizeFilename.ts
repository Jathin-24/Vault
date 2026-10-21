/**
 * Filename sanitisation. The original filename is DATA (shown in the UI,
 * echoed in Content-Disposition) — never a path, never trusted.
 */

/** Strip path separators, control/format characters (RTL override!), leading dots. */
export function sanitizeFilename(raw: string): string {
  let name = (raw ?? "")
    .normalize("NFC")
    // Cc = control, Cf = format chars (U+202E RTL override used to fake ".exe")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\\/]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s]+/, "")
    .replace(/[\s]+$/, "");

  if (!name) name = "document";

  if (name.length > 150) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, 150 - ext.length) + ext;
  }

  return name;
}

/** Lowercased extension without the dot, or null if not a clean extension. */
export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
}

/**
 * RFC 6266 Content-Disposition value. ASCII fallback + UTF-8 filename*.
 * Also the last line of defence against header injection: quotes,
 * backslashes and anything non-ASCII are removed from the fallback.
 */
export function contentDispositionAttachment(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Filename sanitisation — filenames are DATA, never paths. The original name
 * is displayed and echoed in Content-Disposition, so traversal sequences,
 * control characters and RTL-override tricks must all die here.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeFilename,
  extensionOf,
  contentDispositionAttachment,
} from "@/lib/documents/sanitizeFilename";

describe("sanitizeFilename", () => {
  it("strips path traversal", () => {
    expect(sanitizeFilename("../../../etc/passwd")).not.toContain("/");
    expect(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe")).not.toContain("\\");
    expect(sanitizeFilename("....//evil.txt")).not.toContain("..");
  });

  it("removes control and format characters (incl. the RTL override attack)", () => {
    // U+202E makes "exe.gpj.png" render as "gnp.exe.gpj" in naive UIs.
    const rtl = "invoice\u202Egnp.exe";
    expect(sanitizeFilename(rtl)).not.toContain("\u202E");
    expect(sanitizeFilename("bad\r\nname.txt")).not.toMatch(/[\r\n]/);
    expect(sanitizeFilename("nul\u0000byte.txt")).not.toContain("\u0000");
  });

  it("collapses leading dots and whitespace (no hidden or dot-only names)", () => {
    expect(sanitizeFilename("...hidden.txt")).toBe("hidden.txt");
    expect(sanitizeFilename("   spaced.txt")).toBe("spaced.txt");
    expect(sanitizeFilename("trailing.txt   ")).toBe("trailing.txt");
  });

  it("falls back to a neutral name instead of producing an empty string", () => {
    expect(sanitizeFilename("")).toBe("document");
    expect(sanitizeFilename("..")).toBe("document");
    expect(sanitizeFilename("\u202E")).toBe("document");
  });

  it("caps length at 150 characters but keeps the extension", () => {
    const long = sanitizeFilename(`${"a".repeat(300)}.txt`);
    expect(long.length).toBeLessThanOrEqual(150);
    expect(long.endsWith(".txt")).toBe(true);
  });
});

describe("extensionOf", () => {
  it("returns the lowercased extension", () => {
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });

  it("returns null for names without a clean extension", () => {
    expect(extensionOf("noextension")).toBeNull();
    expect(extensionOf(".bashrc")).toBeNull(); // dot-only prefix
    expect(extensionOf("trailing.")).toBeNull();
    expect(extensionOf("weird.e xt")).toBeNull();
  });
});

describe("contentDispositionAttachment", () => {
  it("never allows header injection", () => {
    const value = contentDispositionAttachment('evil"\r\nSet-Cookie: x=1;.txt');
    // No CR/LF anywhere (header injection), and the ASCII fallback between
    // the quotes contains no quote/backslash of its own.
    expect(value).not.toMatch(/[\r\n]/);
    const fallback = value.match(/filename="([^"]*)"/)?.[1] ?? "";
    expect(fallback).not.toMatch(/["\\\r\n]/);
    expect(fallback).toContain("Set-Cookie"); // harmless: plain text in a header value
  });

  it("provides an ASCII fallback plus RFC 5987 encoding for unicode names", () => {
    const value = contentDispositionAttachment("rapport français.pdf");
    expect(value).toContain('filename="rapport fran');
    expect(value).toContain("filename*=UTF-8''rapport");
  });
});

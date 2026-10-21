/**
 * Upload validation — content decides the type. Extension, declared MIME and
 * filename are all attacker-controlled; only the bytes are evidence.
 */
import { describe, it, expect } from "vitest";
import { validateUpload, sniffContent } from "@/lib/documents/validateUpload";

const bytes = (s: string) => Buffer.from(s);

const PDF = bytes("%PDF-1.7\nbody\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = (() => {
  const b = Buffer.alloc(16);
  b.set(bytes("RIFF"), 0);
  b.set(bytes("WEBP"), 8);
  return b;
})();
const ZIP = (() => {
  const b = Buffer.alloc(64);
  b.set([0x50, 0x4b, 0x03, 0x04], 0);
  return b;
})();
const OOXML = (() => {
  const b = Buffer.alloc(128);
  b.set([0x50, 0x4b, 0x03, 0x04], 0);
  b.set(bytes("[Content_Types].xml"), 16);
  return b;
})();

describe("sniffContent", () => {
  it("recognises each family by magic bytes", () => {
    expect(sniffContent(PDF)).toBe("pdf");
    expect(sniffContent(PNG)).toBe("png");
    expect(sniffContent(JPEG)).toBe("jpeg");
    expect(sniffContent(WEBP)).toBe("webp");
    expect(sniffContent(OOXML)).toBe("ooxml");
    expect(sniffContent(bytes("plain text"))).toBe("text");
  });

  it("treats a bare zip (no [Content_Types].xml) as unknown", () => {
    expect(sniffContent(ZIP)).toBe("unknown");
  });

  it("treats NUL bytes and empty content as unknown — not text", () => {
    expect(sniffContent(Buffer.from([0x61, 0x00, 0x62]))).toBe("unknown");
    expect(sniffContent(Buffer.alloc(0))).toBe("unknown");
  });

  it("treats invalid UTF-8 as unknown", () => {
    expect(sniffContent(Buffer.from([0x61, 0xff, 0xfe, 0xfd]))).toBe("unknown");
  });
});

describe("validateUpload", () => {
  it("accepts an honest text file and derives the canonical mime itself", () => {
    const res = validateUpload({
      filename: "notes.txt",
      declaredMime: "text/plain; charset=utf-8",
      bytes: bytes("hello world\n"),
    });
    expect(res.ok).toBe(true);
    expect(res.mimeType).toBe("text/plain"); // from the ALLOWLIST, not the client
    expect(res.extension).toBe("txt");
    expect(res.sizeBytes).toBe(12);
  });

  it("rejects extensions outside the allowlist", () => {
    const res = validateUpload({
      filename: "run.exe",
      declaredMime: "application/octet-stream",
      bytes: bytes("MZ"),
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/not allowed/i);
  });

  it("rejects content that does not match its extension", () => {
    const res = validateUpload({
      filename: "cover.png",
      declaredMime: "image/png",
      bytes: PDF,
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/does not match/i);
  });

  it("rejects dangerous declared types regardless of content", () => {
    for (const declared of ["text/html", "image/svg+xml", "application/javascript"]) {
      const res = validateUpload({
        filename: "page.txt",
        declaredMime: declared,
        bytes: bytes("<html></html>"),
      });
      expect(res.ok).toBe(false);
      expect(res.errors.join(" ")).toMatch(/Content type .* is not allowed/i);
    }
  });

  it("rejects an empty file", () => {
    const res = validateUpload({
      filename: "empty.txt",
      declaredMime: "text/plain",
      bytes: Buffer.alloc(0),
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/empty/i);
  });

  it("rejects a file over the size cap", () => {
    const res = validateUpload({
      filename: "huge.txt",
      declaredMime: "text/plain",
      bytes: Buffer.alloc(26 * 1024 * 1024), // 26 MB > 25 MB default cap
    });
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/MB limit/i);
  });

  it("accepts a real OOXML container and rejects a bare zip wearing .docx", () => {
    const real = validateUpload({
      filename: "contract.docx",
      declaredMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: OOXML,
    });
    expect(real.ok).toBe(true);

    const fake = validateUpload({
      filename: "contract.docx",
      declaredMime: "application/octet-stream",
      bytes: ZIP,
    });
    expect(fake.ok).toBe(false);
  });

  it("accepts matching pairs across the families", () => {
    const cases: Array<[string, Buffer, string]> = [
      ["photo.png", PNG, "image/png"],
      ["photo.jpg", JPEG, "image/jpeg"],
      ["banner.webp", WEBP, "image/webp"],
    ];
    for (const [filename, content, mime] of cases) {
      const res = validateUpload({ filename, declaredMime: mime, bytes: content });
      expect(res.errors, `${filename}: ${res.errors.join("; ")}`).toHaveLength(0);
    }
  });
});

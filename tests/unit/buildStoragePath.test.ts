/**
 * Storage paths are SERVER-GENERATED. The attacker's filename never reaches
 * the object key, so traversal into another document's prefix is impossible
 * by construction (and a DB CHECK pins each version row under its own id).
 */
import { describe, it, expect } from "vitest";
import { buildStoragePath } from "@/lib/documents/buildStoragePath";

const DOC_ID = "3f1a2b9c-1111-4222-8333-444455556666";

describe("buildStoragePath", () => {
  it("produces {documentId}/v{n}/{uuid}.{ext}", () => {
    const path = buildStoragePath(DOC_ID, 3, "pdf");
    expect(path).toMatch(
      /^3f1a2b9c-1111-4222-8333-444455556666\/v3\/[0-9a-f-]{36}\.pdf$/
    );
  });

  it("never reuses a key (fresh uuid per call) — safe with upsert:false", () => {
    const a = buildStoragePath(DOC_ID, 1, "txt");
    const b = buildStoragePath(DOC_ID, 1, "txt");
    expect(a).not.toBe(b);
  });

  it("hostile extensions cannot escape the {documentId}/v{n}/ prefix", () => {
    expect(() => buildStoragePath(DOC_ID, 1, "../png")).toThrow(/invalid extension/i);
    expect(() => buildStoragePath(DOC_ID, 1, "P%41G")).toThrow(/invalid extension/i);
    expect(() => buildStoragePath(DOC_ID, 1, "png/../../etc")).toThrow(/invalid extension/i);
    // The prefix itself comes from the (route-validated) document id argument;
    // only uuid-shaped ids are accepted:
    expect(() => buildStoragePath("00000000-0000-4000-8000-evil", 1, "txt")).toThrow(
      /invalid document id/i
    );
  });

  it("rejects malformed inputs outright", () => {
    expect(() => buildStoragePath("not-a-uuid", 1, "txt")).toThrow(/invalid document id/i);
    expect(() => buildStoragePath(DOC_ID, 0, "txt")).toThrow(/invalid version number/i);
    expect(() => buildStoragePath(DOC_ID, 1.5, "txt")).toThrow(/invalid version number/i);
    expect(() => buildStoragePath(DOC_ID, -1, "txt")).toThrow(/invalid version number/i);
    expect(() => buildStoragePath(DOC_ID, 1, "")).toThrow(/invalid extension/i);
    expect(() => buildStoragePath(DOC_ID, 1, "txt/../../etc")).toThrow(/invalid extension/i);
  });
});

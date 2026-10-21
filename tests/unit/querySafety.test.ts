/**
 * Query-safety helpers + document search parameter parsing.
 *
 * SQL injection is already impossible (every query is parameterised through
 * PostgREST), but two subtler leaks live at this layer:
 *   - PATTERN injection: "%" or "_" in a search term match everything;
 *   - OR-injection in PostgREST's .or() filter syntax.
 * Both must be neutralised before input reaches a query builder.
 */
import { describe, it, expect } from "vitest";
import { escapeIlike, isTermCausedSearchError, parseDateOnly, quoteOrValue } from "@/lib/http/querySafety";
import { parseDocumentSearchParams } from "@/lib/documents/documentSearch";

describe("escapeIlike", () => {
  it("escapes the three wildcard characters", () => {
    expect(escapeIlike("100%")).toBe("100\\%");
    expect(escapeIlike("a_b")).toBe("a\\_b");
    expect(escapeIlike("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeIlike("quarterly report")).toBe("quarterly report");
  });
});

describe("quoteOrValue (PostgREST .or() filter grammar)", () => {
  it("wraps the value in double quotes so reserved characters stay literal", () => {
    expect(quoteOrValue(`%${escapeIlike("' OR '1'='1")}%`)).toBe(
      `"%' OR '1'='1%"`
    );
    // commas / parens would otherwise split the logic tree
    expect(quoteOrValue("%a,b(c)%")).toBe('"%a,b(c)%"');
  });

  it("escapes embedded quotes and backslashes exactly once", () => {
    expect(quoteOrValue(`%say "hi"%`)).toBe(`"%say \\"hi\\"%"`);
    expect(quoteOrValue("%50\\%%")).toBe('"%50\\\\%%"');
  });
});

describe("isTermCausedSearchError", () => {
  it("recognises PostgREST filter parse errors", () => {
    expect(isTermCausedSearchError({ code: "PGRST100", message: "failed to parse logic tree" })).toBe(true);
  });

  it("recognises WAF/CDN HTML pages thrown back as the 'body'", () => {
    expect(isTermCausedSearchError({ code: null, message: "<!DOCTYPE html>...Attention Required! | Cloudflare" })).toBe(true);
    expect(isTermCausedSearchError({ code: "XX000", message: "cf-error-520" })).toBe(true);
  });

  it("does NOT swallow real failures — those must still throw", () => {
    expect(isTermCausedSearchError({ code: "42501", message: "permission denied for table documents" })).toBe(false);
    expect(isTermCausedSearchError({ code: "PGRST202", message: "function not found" })).toBe(false);
    expect(isTermCausedSearchError({ code: null, message: "fetch failed" })).toBe(false);
  });
});

describe("parseDateOnly", () => {
  it("accepts ISO dates", () => {
    expect(parseDateOnly("2026-10-25")).toBe("2026-10-25");
  });

  it("rejects everything else", () => {
    expect(parseDateOnly("25-10-2026")).toBeNull();
    expect(parseDateOnly("2026-10-25T00:00:00Z")).toBeNull();
    expect(parseDateOnly("2026-13-45")).toBeNull(); // month 13 parses? Date says no
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(42)).toBeNull();
    expect(parseDateOnly("'; drop table documents;--")).toBeNull();
  });
});

describe("parseDocumentSearchParams", () => {
  const parse = (query: string) => parseDocumentSearchParams(new URLSearchParams(query));

  it("applies safe defaults", () => {
    const res = parse("");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.filters.status).toBe("active");
      expect(res.filters.limit).toBe(25);
      expect(res.filters.page).toBe(1);
    }
  });

  it("clamps limit and page into sane bounds", () => {
    const huge = parse("limit=99999&page=-3");
    expect(huge.ok).toBe(true);
    if (huge.ok) {
      expect(huge.filters.limit).toBe(100); // capped
      expect(huge.filters.page).toBe(1); // no negative offsets
    }
    const zero = parse("limit=0");
    if (zero.ok) expect(zero.filters.limit).toBe(1);
  });

  it("rejects control characters in the search term", () => {
    const res = parse("q=hello%00world");
    expect(res.ok).toBe(false);
  });

  it("rejects unknown statuses, categories and malformed folders", () => {
    expect(parse("status=everything").ok).toBe(false);
    expect(parse("category=;drop").ok).toBe(false);
    expect(parse("folderId=not-a-uuid").ok).toBe(false);
  });

  it("rejects impossible date ranges", () => {
    expect(parse("from=2026-10-25&to=2026-10-01").ok).toBe(false);
    expect(parse("from=garbage").ok).toBe(false);
  });

  it("keeps hostile terms as literal TEXT (they are escaped later, in escapeIlike)", () => {
    const res = parse("q=" + encodeURIComponent("' or '1'='1"));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.filters.q).toBe("' or '1'='1"); // untouched, not interpreted
  });
});

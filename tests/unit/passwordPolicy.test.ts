/**
 * Password policy — the gate at signup, enforced server-side only.
 * (Client-side checks are UX; these tests pin the real function.)
 */
import { describe, it, expect } from "vitest";
import {
  checkPasswordStrength,
  isPlausibleEmail,
} from "@/lib/auth/passwordPolicy";

describe("checkPasswordStrength", () => {
  it("accepts the demo password (and long, mixed passwords)", () => {
    expect(checkPasswordStrength("TrustVault!Demo2026").ok).toBe(true);
    expect(checkPasswordStrength("correct horse Battery-9tamp").ok).toBe(true);
  });

  it("rejects anything under 12 characters — the hackathon requirement", () => {
    const short = checkPasswordStrength("Ab3!xY9#wQ2"); // 11 chars
    expect(short.ok).toBe(false);
    expect(short.problems.join(" ")).toMatch(/at least 12 characters/i);

    expect(checkPasswordStrength("aB3!xY9#wQ").ok).toBe(false); // 10
    expect(checkPasswordStrength("").ok).toBe(false);
  });

  it("caps length at 128 (bcrypt input limit)", () => {
    const long = checkPasswordStrength(`Aa1!${"x".repeat(130)}`);
    expect(long.ok).toBe(false);
    expect(long.problems.join(" ")).toMatch(/at most 128/i);
  });

  it("requires at least three character classes", () => {
    expect(checkPasswordStrength("abcdefghijklmnop").ok).toBe(false); // lower only
    expect(checkPasswordStrength("ABCDEFGHJKLMNPQR").ok).toBe(false); // upper only
    expect(checkPasswordStrength("passwordpassword").ok).toBe(false); // lower only
    // Three classes at exactly 12 chars is enough:
    expect(checkPasswordStrength("abcdefghijK1").ok).toBe(true);
    expect(checkPasswordStrength("abcdefghij!1").ok).toBe(true);
  });

  it("rejects a single repeated character", () => {
    expect(checkPasswordStrength("aaaaaaaaaaaa").ok).toBe(false);
    expect(checkPasswordStrength("!!!!!!!!!!!!").ok).toBe(false);
  });

  it("rejects very common passwords", () => {
    expect(checkPasswordStrength("password123").problems.join(" ")).toMatch(/too common/i);
    expect(checkPasswordStrength("trustvault123").ok).toBe(false);
  });

  it("rejects passwords containing the email local part", () => {
    const res = checkPasswordStrength("AvaOwner!2026x", "avaowner@trustvault.test");
    expect(res.ok).toBe(false);
    expect(res.problems.join(" ")).toMatch(/email address/i);
  });

  it("reports every problem at once (one round-trip of feedback)", () => {
    const res = checkPasswordStrength("short", "short@trustvault.test");
    expect(res.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isPlausibleEmail("ava@trustvault.test")).toBe(true);
    expect(isPlausibleEmail("a.b+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects malformed or weaponised input", () => {
    expect(isPlausibleEmail("not-an-email")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false); // no dot in domain
    expect(isPlausibleEmail("a@@trustvault.test")).toBe(false);
    expect(isPlausibleEmail("a..b@trustvault.test")).toBe(false); // double dot
    expect(isPlausibleEmail(`${"a".repeat(250)}@trustvault.test`)).toBe(false);
  });
});

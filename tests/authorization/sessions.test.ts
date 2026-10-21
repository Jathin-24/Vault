/**
 * SESSIONS AND AUTH BOUNDARIES — the layer under everything else.
 *
 * Covers: uniform login failures (no account enumeration), the deactivated
 * account (the "leaver": an existing, previously-valid user), server-side
 * password policy at signup, forged cookies, and the rate limits that make
 * credential stuffing impractical.
 *
 * Note on ordering: the rate-limit test deliberately burns attempts against
 * one throwaway email. It runs last in this file, and the login route's
 * per-IP limit (30 / 5 min) leaves room for the other suites' cached logins.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { HTTP_ENABLED, TEST_DEMO_PASSWORD } from "../helpers/env";
import { asAccount, DEMO_ACCOUNTS } from "../helpers/accounts";
import { TestClient, anonymous } from "../helpers/http";

describe.skipIf(!HTTP_ENABLED)("sessions and auth boundaries", () => {
  let base: string;

  beforeAll(() => {
    base = process.env.TEST_BASE_URL ?? "";
  });

  it("a wrong password gets the same generic failure as a wrong email", async () => {
    const client = anonymous(base);
    const wrongPassword = await client.post("/api/auth/login", {
      email: DEMO_ACCOUNTS.owner,
      password: "definitely-not-the-password",
    });
    const wrongEmail = await client.post("/api/auth/login", {
      email: "nobody-here@trustvault.test",
      password: TEST_DEMO_PASSWORD,
    });

    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    // Identical bodies: the response cannot be used to enumerate accounts.
    expect(wrongPassword.json<{ error: string }>().error).toBe(
      wrongEmail.json<{ error: string }>().error
    );
  });

  it("failed logins are recorded as evidence", async () => {
    const login = await new TestClient(base).post("/api/auth/login", {
      email: DEMO_ACCOUNTS.outsider,
      password: "wrong-password-on-purpose",
    });
    expect(login.status).toBe(401);

    // The seeded admin reads the trail: the failure must be there.
    const adminClient = await asAccount("admin");
    const res = await adminClient.get(
      `/api/admin/audit?eventType=auth.login_failed&limit=20`
    );
    expect(res.status).toBe(200);
    const events = res.json<{ events: { target_email: string | null }[] }>().events;
    expect(
      events.some((e) => e.target_email === DEMO_ACCOUNTS.outsider)
    ).toBe(true);
  });

  it("a deactivated account cannot log in — even with the CORRECT password", async () => {
    // The leaver scenario: an account that USED to work. The admin flips the
    // switch (PATCH /api/admin/users), and from then on the login route
    // refuses the account outright — the same generic 401 as any stranger.
    const adminClient = await asAccount("admin");
    const directory = await adminClient.get("/api/admin/users");
    expect(directory.status).toBe(200);
    const leaver = directory
      .json<{ users: { id: string; email: string }[] }>()
      .users.find((u) => u.email === DEMO_ACCOUNTS.leaver);
    expect(leaver).toBeDefined();

    const deactivate = await adminClient.patch("/api/admin/users", {
      userId: leaver?.id,
      isActive: false,
    });
    expect(deactivate.status).toBe(200);
    expect(
      deactivate.json<{ user: { is_active: boolean } }>().user.is_active
    ).toBe(false);

    const client = anonymous(base);
    const res = await client.post("/api/auth/login", {
      email: DEMO_ACCOUNTS.leaver,
      password: TEST_DEMO_PASSWORD, // even with the CORRECT password
    });
    expect(res.status).toBe(401);
    expect(res.json<{ error: string }>().error).toBe("Invalid email or password.");
  });

  it("signup enforces the 12-character password policy server-side", async () => {
    const client = anonymous(base);
    const res = await client.post("/api/auth/signup", {
      email: "short-password-probe@trustvault.test",
      password: "Ab3!xY9#wQ2", // 11 chars — one short
      fullName: "Probe",
    });
    expect(res.status).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/at least 12 characters/i);
  });

  it("a forged session cookie is worthless (JWT is verified with Supabase Auth)", async () => {
    const client = new TestClient(base);
    client.setCookie("sb-test-project-auth-token.0", "forged-garbage-payload");
    client.setCookie("sb-test-project-auth-token.1", "more-forged-garbage");

    const res = await client.get("/api/me");
    expect(res.status).toBe(401);
  });

  it("credential stuffing hits the rate limiter", async () => {
    const client = anonymous(base);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await client.post("/api/auth/login", {
        email: "stuffed-target@trustvault.test",
        password: "WrongPassword!2026",
      });
      statuses.push(res.status);
    }
    // 5 per IP+email per 5 minutes: the 6th attempt is cut off.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});

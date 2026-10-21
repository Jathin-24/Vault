/**
 * Demo accounts (created by `npm run db:seed`) + one login per account per
 * machine, cached across test files.
 *
 * Why cache: the login route rate-limits 5 attempts per IP+email and 30 per
 * IP per 5 minutes — real limits, and tests must not dodge them. One login
 * per account is reused everywhere; a cached session that no longer works
 * (expired cookie) is refreshed automatically.
 */
import fs from "node:fs";
import path from "node:path";
import { HTTP_ENABLED, TEST_BASE_URL, TEST_DEMO_PASSWORD } from "./env";
import { TestClient } from "./http";

export const DEMO_ACCOUNTS = {
  admin: "admin@trustvault.test",
  owner: "owner@trustvault.test",
  editor: "editor@trustvault.test",
  viewer: "viewer@trustvault.test",
  outsider: "outsider@trustvault.test",
  leaver: "leaver@trustvault.test", // seeded DEACTIVATED — cannot log in at all
} as const;

export type DemoAccount = keyof typeof DEMO_ACCOUNTS;

const CACHE_FILE = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "trustvault-test-sessions.json"
);

function readCache(): { sessions: Record<string, Record<string, string>> } {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as {
      sessions: Record<string, Record<string, string>>;
    };
  } catch {
    return { sessions: {} };
  }
}

function writeCache(cache: { sessions: Record<string, Record<string, string>> }): void {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

/** Authenticated client for a seeded account (cached session, auto-refresh). */
export async function asAccount(account: DemoAccount): Promise<TestClient> {
  if (!HTTP_ENABLED) {
    throw new Error("asAccount(): TEST_BASE_URL is not set — HTTP suites cannot run.");
  }
  const email = DEMO_ACCOUNTS[account];
  const key = `${TEST_BASE_URL}|${email}`;

  const cache = readCache();
  const saved = cache.sessions[key];

  const client = new TestClient(TEST_BASE_URL);
  if (saved) {
    for (const [name, value] of Object.entries(saved)) client.setCookie(name, value);
    const me = await client.get("/api/me");
    if (me.status === 200) return client; // cached session still valid
    client.clearCookies();
  }

  const res = await client.post("/api/auth/login", {
    email,
    password: TEST_DEMO_PASSWORD,
  });
  if (res.status !== 200) {
    throw new Error(
      `Login failed for ${email} (HTTP ${res.status}: ${res.text.slice(0, 200)}). ` +
        `Is the app at ${TEST_BASE_URL} running against the Supabase project you ` +
        `seeded? Run: npm run db:seed (password override: TEST_DEMO_PASSWORD)`
    );
  }

  cache.sessions[key] = client.snapshotCookies();
  writeCache(cache);
  return client;
}

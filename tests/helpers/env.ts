/**
 * Test environment resolution.
 *
 * Unit tests (tests/unit/**) always run — no environment needed.
 *
 * Authorization tests (tests/authorization/**) talk to a REAL running app
 * against a REAL Supabase project (no mocks: an auth test against a mocked
 * database proves nothing). They need:
 *
 *   TEST_BASE_URL=http://localhost:3000   (the app, running + seeded)
 *
 * and read the same .env.local the app uses (for the optional direct-DB
 * tamper test). If TEST_BASE_URL is missing, those suites are SKIPPED with a
 * loud warning — never silently green.
 *
 * Demo accounts come from `npm run db:seed` (password: TrustVault!Demo2026,
 * overridable with SEED_PASSWORD at seed time / TEST_DEMO_PASSWORD here).
 */
import fs from "node:fs";
import path from "node:path";

// Node 20.12+: load .env.local the same way `next dev` does. Failures are
// fine — everything needed is also accepted from the process environment.
try {
  const envLocal = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envLocal)) process.loadEnvFile(envLocal);
} catch {
  // fall through: variables may already be present in process.env
}

export const TEST_BASE_URL = (process.env.TEST_BASE_URL ?? "").replace(/\/+$/, "");
export const TEST_DEMO_PASSWORD = process.env.TEST_DEMO_PASSWORD ?? "TrustVault!Demo2026";

/** DATABASE_URL: only needed by the direct-SQL tamper-detection test. */
export const DATABASE_URL = process.env.DATABASE_URL ?? "";

/** True when the integration (HTTP) suites can run. */
export const HTTP_ENABLED = TEST_BASE_URL.length > 0;

if (!HTTP_ENABLED) {
  console.warn(
    "\n" +
      "  ┌──────────────────────────────────────────────────────────────────┐\n" +
      "  │  AUTHORIZATION TESTS SKIPPED: TEST_BASE_URL is not set.          │\n" +
      "  │  They are the heart of the suite — run them for real:            │\n" +
      "  │    1. create .env.local (see .env.example)                       │\n" +
      "  │    2. npm run db:migrate && npm run db:seed                      │\n" +
      "  │    3. npm run dev            (keep it running)                   │\n" +
      "  │    4. TEST_BASE_URL=http://localhost:3000 npm test               │\n" +
      "  └──────────────────────────────────────────────────────────────────┘\n"
  );
}

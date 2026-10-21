import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Authorization tests hit a real running app + real Supabase.
    // Set TEST_BASE_URL + TEST_SUPABASE_* env (or use the seeded demo accounts).
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Files run sequentially: they share seeded accounts and assert on audit state.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});

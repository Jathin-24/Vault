"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/supabase/env";

/**
 * Browser Supabase client (anon key only). Whatever this client can reach is
 * ALSO protected by RLS in Postgres — the browser is never trusted.
 */
export function createBrowserSupabase() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
}

import { supabaseKey, supabaseUrl } from "./env";
import { createBrowserClient } from "@supabase/ssr";

/** ブラウザ（Client Component）用の Supabase クライアント */
export function createClient() {
  return createBrowserClient(
    supabaseUrl(),
    supabaseKey(),
  );
}

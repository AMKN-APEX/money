import { supabaseKey, supabaseUrl } from "./env";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server Component / Server Action / Route Handler 用のクライアント。
 * リクエストごとに新しく作ること（クッキーの書き戻しが1回目の書き込みにしか乗らないため）。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl(),
    supabaseKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Component からは書き込めない。セッションの更新は proxy.ts が行うため無視してよい。
          }
        },
      },
    },
  );
}

/** ログイン済みユーザーを返す。未ログインなら null。 */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

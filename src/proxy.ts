import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 の Proxy（旧 Middleware）。
 * 毎リクエストで Supabase のセッションを更新し、未ログインなら /login へ送る。
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    supabaseUrl(),
    supabaseKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // 認証クッキーを載せたレスポンスを CDN にキャッシュさせない
          for (const [key, val] of Object.entries(headers)) {
            response.headers.set(key, val);
          }
        },
      },
    },
  );

  // ここで必ず呼ぶ。レスポンス確定後に更新されるとセッションが失われる。
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/auth");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // 静的ファイル・画像・manifest を除く全経路。
    // api/ingest は GAS からの受信口で、ログインを持てないので除外する
    // （共有シークレットのヘッダーでルート自身が守っている）。
    "/((?!api/ingest|_next/static|_next/image|favicon.ico|icon-|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

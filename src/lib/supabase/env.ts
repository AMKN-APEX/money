/**
 * Supabase の接続情報。
 *
 * NEXT_PUBLIC_ という接頭辞は Next.js の規約で、これが付いた変数だけが
 * ブラウザ側のコードに埋め込まれる。名前を変えるとブラウザから Supabase を
 * 呼べなくなるため、Vercel の環境変数もこの名前で登録すること。
 *
 * 値は process.env.XXX と literal で書く必要がある。Next.js はこの形の記述を
 * ビルド時に文字列へ置換するため、process.env[name] のような動的アクセスだと
 * ブラウザ側で undefined になる。
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。` +
        `ローカルは .env.local、本番は Vercel の Settings > Environment Variables を確認してください。`,
    );
  }
  return value;
}

export function supabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function supabaseKey(): string {
  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

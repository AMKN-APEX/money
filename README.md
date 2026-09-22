# money

個人用の家計簿。iPhone のホーム画面から使う PWA。

- 設計: [docs/design.md](docs/design.md)
- 構成: Next.js (App Router) on Vercel / Supabase (Postgres + Auth)

## セットアップ

### 1. Supabase プロジェクトを作る

1. <https://supabase.com> で新規プロジェクトを作成（Region は Tokyo）
2. **Authentication > Sign In / Providers** で Email を有効にし、**Allow new users to sign up を OFF** にする
   （利用者は1名。あとから誰も登録できないようにする）
3. **Authentication > Users > Add user** で自分のユーザーを1つ作る
   （"Auto Confirm User" を ON にしてメール確認を省く）

### 2. スキーマと初期データを投入

Supabase ダッシュボードの **SQL Editor** で、この順に実行する。

1. `supabase/migrations/20260922000001_init.sql` … テーブル・RLS
2. `supabase/migrations/20260922000002_seed.sql` … 口座・費目・自動分類ルール

seed は `auth.users` の先頭1件を所有者として使うので、**先にユーザーを作っておくこと**。
何度実行しても重複しない。

CLI を使う場合:

```bash
npx supabase link --project-ref <プロジェクトRef>
npm run db:push
```

### 3. 環境変数

`.env.example` を `.env.local` にコピーし、**Project Settings > API Keys** の値を入れる。

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### 4. 起動

```bash
npm install
npm run dev
```

## iPhone に入れる

Vercel へデプロイ（`*.vercel.app` のままでよい）したあと、Safari で開いて
**共有 > ホーム画面に追加**。全画面で起動する。

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（型チェックを含む） |
| `npm run icons` | PWA アイコンを再生成（`scripts/gen-icons.mjs`） |
| `npm run db:push` | マイグレーションを Supabase に適用 |
| `npm run db:types` | DB から TypeScript 型を生成 |

## 注意

金融機関からダウンロードした CSV は口座番号・残高・給与額を含むため
`.gitignore` で除外している（`*.csv` / `data/` / `imports/`）。
パーサーのテスト用サンプルはマスクしたうえで `tests/fixtures/` に置く。

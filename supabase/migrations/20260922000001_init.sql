-- 家計簿アプリ 初期スキーマ
-- 設計: docs/design.md 5章（スキーマ）/ 9.5（残高チェーン）/ 9.6（特別支出の分離）
--
-- 利用者は1名だが、全テーブルに user_id を持たせて RLS で隔離する。
-- default auth.uid() があるため、アプリ側は user_id を渡さなくてよい。

-- gen_random_uuid() は PostgreSQL 13 以降の組み込み。拡張は要らない。

-- ---------------------------------------------------------------- enums

create type account_type    as enum ('bank', 'credit_card', 'emoney', 'securities');
create type category_kind   as enum ('expense', 'income', 'transfer');
create type tx_type         as enum ('income', 'expense', 'transfer');
create type tx_source       as enum ('manual', 'email', 'csv');
create type tx_status       as enum ('confirmed', 'pending_review');
-- 方針1: iD は口座ではなく決済チャネル
create type payment_channel as enum ('card', 'id', 'apple_pay', 'cash', 'bank', 'emoney');
create type rule_match_type as enum ('exact', 'prefix', 'contains', 'regex');

-- ---------------------------------------------------------------- accounts

create table accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name               text not null,
  type               account_type not null,
  issuer             text,
  -- クレジットカードのみ。締め日・支払日（31 = 月末締め）
  closing_day        smallint check (closing_day between 1 and 31),
  payment_day        smallint check (payment_day between 1 and 31),
  payment_account_id uuid references accounts (id) on delete set null,
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, name),
  -- 引落元を持てるのは負債口座だけ
  constraint accounts_payment_account_only_for_cards
    check (payment_account_id is null or type = 'credit_card')
);

create index accounts_user_active_idx on accounts (user_id, is_active, sort_order);

-- ---------------------------------------------------------------- categories

create table categories (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id        uuid references categories (id) on delete cascade,
  name             text not null,
  kind             category_kind not null,
  -- 9.6: true の費目は「通常の月次収支」から除外して別枠表示する
  is_extraordinary boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 同じ親の下で費目名は一意（親なしは親 id を零 uuid とみなす）
create unique index categories_unique_name_idx
  on categories (user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create index categories_user_kind_idx on categories (user_id, kind, sort_order);

-- ---------------------------------------------------------------- import_batches

create table import_batches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id  uuid not null references accounts (id) on delete cascade,
  filename    text not null,
  -- 9.5: 同一内容のファイルを二度取り込まないための冪等キー
  file_md5    text not null,
  period_from date,
  period_to   date,
  row_count   integer not null default 0,
  dup_count   integer not null default 0,
  imported_at timestamptz not null default now(),
  unique (user_id, file_md5)
);

create index import_batches_account_idx on import_batches (user_id, account_id, period_to desc);

-- ---------------------------------------------------------------- transactions

create table transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date                date not null,
  -- 円。符号は持たせず type で向きを表す
  amount              bigint not null check (amount > 0),
  type                tx_type not null,
  account_id          uuid not null references accounts (id) on delete restrict,
  to_account_id       uuid references accounts (id) on delete restrict,
  category_id         uuid references categories (id) on delete set null,
  merchant            text,
  merchant_normalized text,
  channel             payment_channel,
  memo                text,
  source              tx_source not null default 'manual',
  -- 口座側が持つ一意な明細 ID（ゆうちょの入出金明細ＩＤ など）
  source_ref          text,
  status              tx_status not null default 'confirmed',
  -- 重複排除キー（3章）。ゆうちょのように明細 ID がある口座では source_ref をそのまま使う
  dedup_key           text,
  import_batch_id     uuid references import_batches (id) on delete set null,
  -- 9.5 残高チェーン検証用。CSV 由来の行のみ入る
  balance_after       bigint,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- 振替は相手口座が要り、自己振替は禁止
  constraint transactions_transfer_needs_to_account
    check (
      (type = 'transfer' and to_account_id is not null and to_account_id <> account_id)
      or (type <> 'transfer' and to_account_id is null)
    )
);

create unique index transactions_dedup_idx
  on transactions (user_id, dedup_key) where dedup_key is not null;
create unique index transactions_source_ref_idx
  on transactions (user_id, account_id, source_ref) where source_ref is not null;
create index transactions_user_date_idx on transactions (user_id, date desc, created_at desc);
create index transactions_account_date_idx on transactions (user_id, account_id, date desc);
create index transactions_category_date_idx on transactions (user_id, category_id, date desc);
-- 未分類トレイ（9.7）の取り出し
create index transactions_pending_idx
  on transactions (user_id, date desc) where status = 'pending_review';

-- ---------------------------------------------------------------- rules

create table rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  priority      integer not null default 100,
  match_type    rule_match_type not null default 'prefix',
  -- 正規化済み（NFKC）の摘要に対して照合する。9.2 参照
  pattern       text not null,
  -- null なら全口座が対象
  account_id    uuid references accounts (id) on delete cascade,
  -- 適用結果
  set_type      tx_type,
  category_id   uuid references categories (id) on delete cascade,
  to_account_id uuid references accounts (id) on delete cascade,
  channel       payment_channel,
  memo_template text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index rules_lookup_idx on rules (user_id, is_active, priority);

-- ---------------------------------------------------------------- budgets

create table budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  year_month  text not null check (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount      bigint not null check (amount >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, category_id, year_month)
);

-- ---------------------------------------------------------------- updated_at

create or replace function set_updated_at() returns trigger
language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create trigger accounts_set_updated_at      before update on accounts
  for each row execute function set_updated_at();
create trigger categories_set_updated_at    before update on categories
  for each row execute function set_updated_at();
create trigger transactions_set_updated_at  before update on transactions
  for each row execute function set_updated_at();
create trigger rules_set_updated_at         before update on rules
  for each row execute function set_updated_at();
create trigger budgets_set_updated_at       before update on budgets
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- RLS

alter table accounts       enable row level security;
alter table categories     enable row level security;
alter table transactions   enable row level security;
alter table rules          enable row level security;
alter table import_batches enable row level security;
alter table budgets        enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','rules','import_batches','budgets']
  loop
    execute format(
      'create policy %I_owner on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t, t);
  end loop;
end;
$rls$;

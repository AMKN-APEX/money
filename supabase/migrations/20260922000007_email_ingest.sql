-- メール速報の受信箱
-- 設計: docs/design.md 3章（メール自動取得）
--
-- **解析する前に、まず生のまま保存する。**
-- カード各社の文面は実物を見るまで分からず、パーサーは後から書くことになる。
-- 「解析できないメールは捨てる」設計にすると、パーサーを用意するまでの期間の
-- 取引が丸ごと失われる。銀行CSVの照会期限（9.4）と同じ失い方をする。
-- そのため受信と解析を分け、status で進捗を持つ。

create type email_status as enum ('unparsed', 'parsed', 'ignored', 'failed');

create table email_messages (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- Gmail のメッセージID。同じメールを二度取り込まないための冪等キー
  gmail_id       text not null,
  received_at    timestamptz not null,
  from_address   text,
  subject        text,
  body           text not null,
  status         email_status not null default 'unparsed',
  -- どのパーサーが処理したか。文面が変わったときの切り分けに使う
  parser_id      text,
  transaction_id uuid references transactions (id) on delete set null,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, gmail_id)
);

create index email_messages_status_idx
  on email_messages (user_id, status, received_at desc);
create index email_messages_received_idx
  on email_messages (user_id, received_at desc);

create trigger email_messages_set_updated_at before update on email_messages
  for each row execute function set_updated_at();

alter table email_messages enable row level security;

create policy email_messages_owner on email_messages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 取り込み経路を追えるように、取引からも受信メールを辿れるようにする
alter table transactions add column email_message_id uuid
  references email_messages (id) on delete set null;

comment on column transactions.email_message_id is
  'メール速報由来の取引の出どころ。あとからCSVで上書きマージするときの突合に使う';

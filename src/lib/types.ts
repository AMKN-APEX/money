// supabase/migrations/20260922000001_init.sql と対応する型。
// テーブルが増えたら supabase gen types typescript に置き換える。

export type AccountType = "bank" | "credit_card" | "emoney" | "securities";
export type CategoryKind = "expense" | "income" | "transfer";
export type TxType = "income" | "expense" | "transfer";
export type TxSource = "manual" | "email" | "csv";
export type TxStatus = "confirmed" | "pending_review";
export type PaymentChannel = "card" | "id" | "apple_pay" | "cash" | "bank" | "emoney";

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  issuer: string | null;
  closing_day: number | null;
  payment_day: number | null;
  payment_account_id: string | null;
  is_active: boolean;
  sort_order: number;
  note: string | null;
};

export type Category = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: CategoryKind;
  is_extraordinary: boolean;
  sort_order: number;
};

export type Transaction = {
  id: string;
  date: string;
  amount: number;
  type: TxType;
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  merchant: string | null;
  merchant_normalized: string | null;
  channel: PaymentChannel | null;
  memo: string | null;
  source: TxSource;
  source_ref: string | null;
  status: TxStatus;
  dedup_key: string | null;
  balance_after: number | null;
};

/** 資産か負債か。カードは負債（方針6 の発生主義で残高が積み上がる） */
export function isLiability(type: AccountType): boolean {
  return type === "credit_card";
}

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  bank: "銀行",
  credit_card: "クレジットカード",
  emoney: "電子マネー",
  securities: "証券",
};

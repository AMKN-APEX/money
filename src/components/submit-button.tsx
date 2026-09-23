"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * 送信ボタン。押している間は見た目を変え、二度押しを止める。
 *
 * iPhone にはカーソルが無いので、押せたかどうかを判断する手段が
 * 「見た目が変わること」しかない。サーバー側の処理は1〜3秒かかるため、
 * 何も変わらないと壊れていると見分けがつかない。
 *
 * 押下中の縮みと明るさは globals.css で全てのボタンに共通で当てている。
 * ここで足すのは「送信中」の状態だけ。
 */
export function SubmitButton({
  children,
  pendingLabel = "処理中…",
  className = "",
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={className} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

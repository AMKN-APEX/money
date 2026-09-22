"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-xl bg-rose-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? "削除中…" : "本当に削除する"}
    </button>
  );
}

/** 誤タップで消えないよう二段階にする */
export function DeleteButton() {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="w-full rounded-xl border border-rose-900 py-3 text-sm font-medium text-rose-400"
      >
        この取引を削除
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="flex-1 rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-300"
      >
        やめる
      </button>
      <ConfirmButton />
    </div>
  );
}

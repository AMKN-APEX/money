"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-emerald-500 py-3 text-base font-semibold text-slate-950 transition active:scale-[0.99] disabled:opacity-60"
    >
      {pending ? "ログイン中…" : "ログイン"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(signIn, {
    error: null,
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">メールアドレス</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">パスワード</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-base outline-none focus:border-emerald-500"
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-rose-400">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

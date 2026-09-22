import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === "string" ? raw : "/";

  return (
    <main className="flex min-h-dvh flex-col justify-center bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold">家計簿</h1>
        <p className="mb-8 text-sm text-slate-400">ログインしてください</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}

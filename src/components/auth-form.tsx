"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createAuthClient } from "better-auth/react";
import { Button } from "@/components/ui/button";

const authClient = createAuthClient();
const inputClass = "mt-2 block w-full rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-700";

export function AuthForm() {
  const router = useRouter();
  const [register, setRegister] = useState(false);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"local" | "invite" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "登录服务尚未就绪。");
      setMode(body.mode);
      if (body.mode === "invite" && body.user) router.replace("/");
      const invitation = new URLSearchParams(window.location.hash.slice(1)).get("invite");
      if (invitation) {
        setToken(invitation);
        setRegister(true);
        window.history.replaceState(null, "", window.location.pathname);
      }
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "登录服务尚未就绪。"); });
    return () => controller.abort();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (register) {
        const response = await fetch("/api/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, email, name, password }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "邀请接受未完成，请重试。");
      }
      const result = await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) throw new Error(register ? "账号已创建，请切换到登录后重试。" : "登录未完成，请检查邮箱和密码。");
      router.replace("/");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作未完成，请重试。"); setBusy(false); }
  }

  return <main className="grid min-h-dvh place-items-center px-5 py-12"><section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-7 shadow-sm sm:p-9" aria-labelledby="auth-heading">
    <Link href="/" className="text-sm font-semibold tracking-wider text-emerald-800">GEO · 品牌工作台</Link>
    <h1 id="auth-heading" className="mt-7 text-2xl font-semibold tracking-tight">{register ? "接受邀请，建立账号" : "登录品牌工作区"}</h1>
    <p className="mt-3 text-sm leading-6 text-stone-500">{register ? "请使用邀请绑定的邮箱。新工作区与已有品牌资料分别授权。" : "使用受邀账号查看自己的品牌资料与证据。"}</p>
    {mode === "local" ? <div className="mt-7 space-y-4"><p className="rounded-md bg-stone-100 p-4 text-sm text-stone-600">当前为仅限本机的研发预览。邀请登录尚未启用；操作员配置后才能建立账号。</p><Link href="/" className="button button-primary">返回本地工作台</Link></div> : <form onSubmit={(event) => void submit(event)} className="mt-7 space-y-5">
      <fieldset disabled={busy || mode !== "invite"} className="space-y-5">
        {register && <><label className="block text-sm font-medium">邀请凭证<input name="invitation" value={token} onChange={(event) => setToken(event.target.value)} className={inputClass} required autoComplete="off" spellCheck={false} maxLength={96} type="password" /></label><label className="block text-sm font-medium">姓名<input name="name" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required autoComplete="name" maxLength={120} /></label></>}
        <label className="block text-sm font-medium">邮箱<input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} required autoComplete="email" maxLength={320} /></label>
        <label className="block text-sm font-medium">密码<input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} required autoComplete={register ? "new-password" : "current-password"} minLength={12} maxLength={128} />{register && <small className="mt-2 block font-normal text-stone-500">至少12个字符。请为此账号使用独立密码。</small>}</label>
        <Button className="w-full" type="submit" disabled={busy || mode !== "invite"}>{busy ? "正在处理…" : register ? "接受邀请并登录" : "登录"}</Button>
      </fieldset>
      <button type="button" onClick={() => { setRegister(!register); setError(""); }} className="text-sm text-emerald-800 underline underline-offset-4" disabled={busy}>{register ? "已有账号？返回登录" : "收到邀请？接受邀请"}</button>
    </form>}
    {error && <p className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
    <p className="mt-7 border-t border-stone-100 pt-5 text-xs leading-5 text-stone-500">当前能力仍按工程验收逐步开放。登录成功不代表真实采样通道或企业效果已完成验收。</p>
  </section></main>;
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createAuthClient } from "better-auth/react";
import { Button } from "@/components/ui/button";

const authClient = createAuthClient();

interface SessionSummary {
  mode: "local" | "invite";
  user: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string } | null;
  needsLogin: boolean;
}

export function AuthStatus({ onBeforeSignOut }: { onBeforeSignOut?: () => boolean }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "暂时无法读取登录状态。");
        setSession(body);
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "登录状态读取失败。"); });
    return () => controller.abort();
  }, []);

  async function signOut() {
    if (onBeforeSignOut && !onBeforeSignOut()) return;
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("退出未完成，请重试。");
      router.replace("/login");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "退出未完成，请重试。"); setBusy(false); }
  }

  if (error) return <span className="text-xs text-red-700" role="alert">{error}</span>;
  if (!session) return <span className="text-xs text-stone-500" role="status">读取访问状态…</span>;
  if (session.mode === "local") return <span className="text-xs text-stone-600">本地研发预览</span>;
  if (session.needsLogin) return <Link className="button button-secondary button-small" href="/login">受邀登录</Link>;
  return <div className="flex items-center gap-3"><span className="text-xs text-stone-600" title={session.user?.email}>{session.user?.name}</span><Button type="button" size="small" variant="secondary" disabled={busy} onClick={() => void signOut()}>{busy ? "正在退出…" : "退出"}</Button></div>;
}

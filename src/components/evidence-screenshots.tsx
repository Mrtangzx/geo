"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import type { EvidenceAttachment } from "@/lib/import-contracts";
import { Button } from "./ui/button";
import { formatProjectDate, projectApi } from "./project-api";

export async function uploadScreenshot(projectId: string, evidenceId: string, file: File) {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("仅支持每张不超过5MB的PNG/JPEG截图。");
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error("截图读取失败。"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(file);
  });
  return projectApi<{ attachment: EvidenceAttachment }>(`/api/projects/${projectId}/evidence/${evidenceId}/attachments`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 }),
  });
}

export function EvidenceScreenshots({ projectId, evidenceId, onChanged }: { projectId: string; evidenceId: string; onChanged: () => Promise<void> }) {
  const [attachments, setAttachments] = useState<EvidenceAttachment[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = `/api/projects/${projectId}/evidence/${evidenceId}/attachments`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await projectApi<{ attachments: EvidenceAttachment[] }>(path, { signal });
    if (!signal?.aborted) setAttachments(result.attachments);
  }, [path]);
  useEffect(() => {
    const c = new AbortController();
    Promise.resolve().then(() => load(c.signal)).catch((e: unknown) => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "截图读取失败。"); });
    return () => c.abort();
  }, [load]);
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await uploadScreenshot(projectId, evidenceId, file); await load(); await onChanged(); setMessage("截图已保存，重复图片复用已有附件。后续报告可绑定本次附件依据。"); }
    catch (e) { setError(e instanceof Error ? e.message : "上传未完成，回答原文不受影响，可选择同一文件重试。"); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 border-t pt-4" aria-label="回答截图"><h4 className="font-semibold">回答截图</h4><p className="my-2 text-sm text-[#68756c]">仅本工作区授权账号可访问。每条最多3张，每张PNG/JPEG不超过5MB；截图不能自动代替全文或正文引用映射。</p>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{message && <p role="status" className="text-sm text-green-800">{message}</p>}
    <label className="field my-3"><span>{busy ? "正在校验并保存截图" : "添加截图（可重复选择重试）"}</span><input type="file" accept="image/png,image/jpeg" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void upload(file); }} /></label>
    <div className="grid gap-3 sm:grid-cols-2">{attachments.map((a) => <div className="rounded-md border border-[#dfe5dc] p-3" key={a.id}><a href={`${path}/${a.id}`} target="_blank" rel="noreferrer"><Image src={`${path}/${a.id}`} alt={`原回答截图：${a.filename}`} width={a.width} height={a.height} unoptimized className="h-auto max-h-80 w-auto max-w-full object-contain" /></a><p className="mt-2 break-all text-sm">{a.filename} · {a.width}×{a.height}<br />{formatProjectDate(a.uploadedAt)} · {a.uploadedBy}</p><details className="mt-2 text-xs"><summary>截图校验摘要</summary><p className="break-all">SHA-256 {a.sha256}</p></details><Button asChild variant="ghost" size="small"><a href={`${path}/${a.id}`} target="_blank" rel="noreferrer">查看完整截图</a></Button></div>)}</div>
  </section>;
}

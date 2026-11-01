"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/lib/contracts";
import type { ModificationTask, TaskCollection } from "@/lib/task-contracts";
import { Button } from "./ui/button";
import { formatProjectDate, projectApi } from "./project-api";

const states: Record<string, string> = { needs_material: "待补资料", awaiting_approval: "待审核", awaiting_publication: "待发布", waiting_external: "等待外部处理", awaiting_verification: "待核验", verified_pending_review: "已上线待复查", synthetic_verified_pending_review: "演练核验通过待复查", reviewed: "已复查", synthetic_reviewed: "演练已复查", cancelled: "已取消" };
export function TasksPanel({ project, onDirtyChange }: { project: Project; onDirtyChange: (dirty: boolean) => void }) {
  const base = `/api/projects/${project.id}/tasks`;
  const [collection, setCollection] = useState<TaskCollection | null>(null);
  const [selected, setSelected] = useState<ModificationTask | null>(null);
  const [text, setText] = useState("");
  const [snapshotId, setSnapshotId] = useState("");
  const [reason, setReason] = useState("");
  const [declaredAt, setDeclaredAt] = useState("2026-10-03T10:00:00.000Z");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = !!selected && text !== (selected.proposedText ?? "");
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await projectApi<TaskCollection>(base, { signal });
    if (!signal?.aborted) setCollection(data);
    return data;
  }, [base]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal)).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "任务读取失败。"); });
    return () => controller.abort();
  }, [load]);
  async function act(url: string, body: unknown, method = "POST") {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await projectApi<{ task?: ModificationTask }>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const current = await load();
      const updated = result.task ?? current.tasks.find((t) => t.id === selected?.id);
      if (updated) { setSelected(updated); setText(updated.proposedText ?? ""); }
      setMessage("任务记录已保存；申报或部分条件通过不等于全部上线。");
    } catch (e) { setError(e instanceof Error ? e.message : "操作未完成，当前编辑保留。"); }
    finally { setBusy(false); }
  }
  function choose(task: ModificationTask) {
    if (dirty && !window.confirm("当前任务有未保存修改，是否放弃？")) return;
    setSelected(task); setText(task.proposedText ?? ""); setReason(""); setSnapshotId("");
    setDeclaredAt(project.isSynthetic ? "2026-10-03T10:00:00.000Z" : new Date().toISOString());
  }
  function action(action: string, extra: object = {}) { if (selected) void act(`${base}/${selected.id}/actions`, { action, expectedRevision: selected.revision, ...extra }); }
  const release = selected?.releases.filter((r) => !r.superseded).at(-1);
  return <section className="form-panel" aria-label="修改任务">
    <div className="panel-heading"><div><h2>有依据的修改任务</h2><p>核对位置、事实、草稿和逐项条件，客户自行发布；平台保存核验依据。</p></div><Button disabled={busy} onClick={() => void act(base, { mode: project.isSynthetic ? "synthetic_template" : "analysis_diagnosis" })}>生成{project.isSynthetic ? "合成演练" : "诊断"}任务</Button></div>
    {project.isSynthetic && <div className="synthetic-banner mb-4">合成模板与离线页面回放，核验不会被记录为真实网站上线。</div>}
    {error && <p role="alert" className="mb-4 text-red-800">{error}</p>}{message && <p role="status" className="mb-4 text-green-800">{message}</p>}
    <div className="grid gap-3">{collection?.tasks.map((task) => <button type="button" key={task.id} className="flex flex-wrap justify-between gap-3 rounded-md border border-[#dfe5dc] p-4 text-left hover:bg-[#f7f8f5]" onClick={() => choose(task)}><span><strong>{task.fixtureTaskId ? `${task.fixtureTaskId} · ` : ""}{task.title}</strong><small className="mt-1 block">{task.targetUrl} · {task.position}</small></span><span className="status-pill">{states[task.state]} · 草稿V{task.draftVersion}</span></button>)}</div>
    {!collection?.tasks.length && <p className="py-8 text-[#68756c]">尚无任务。请先在检查结果中导入回答并完成分析，再生成建议。</p>}
    {selected && <article className="mt-5 rounded-md border border-[#cddbc8] p-5"><h3 className="text-lg font-semibold">{selected.title}</h3><p className="mt-2 text-sm">{states[selected.state]} · 任务版本 {selected.revision} · 依据资料V{selected.basis.projectVersion}{selected.basisStale ? " · 依据已变化，须重新审核" : ""}</p><p className="my-3">目标：{selected.targetUrl} · {selected.position}</p>
      <details className="mb-4 text-sm" open><summary>为什么修改：证据与事实</summary>{selected.evidence.map((e, i) => <blockquote className="my-2 border-l-2 border-[#b7ccb0] pl-3" key={i}>{e.quote || e.id}</blockquote>)}<p>待验证假设：{selected.hypothesis}</p>{selected.missingFactIds.length > 0 && <p className="mt-2 text-amber-800">缺少确认资料；不能把认证、报价或能力补写为确定事实。</p>}</details>
      <label className="field"><span>建议文案（修改后须重新审核）</span><textarea className="min-h-28 w-full rounded-md border border-[#dfe5dc] p-3" value={text} onChange={(e) => setText(e.target.value)} disabled={busy || selected.state === "cancelled"} /></label>
      <ol className="my-4 list-inside list-decimal space-y-1 text-sm">{selected.conditions.map((c, i) => <li key={i}>{c.kind === "text_absent" ? `旧说法消失：${c.text}` : c.kind === "text_present" || c.kind === "readable_body" ? `正文包含：${c.text}` : c.kind === "http_status" ? `HTTP状态为${c.equals}` : c.kind === "robots_allows" ? `robots允许 ${c.path}` : c.kind === "no_noindex" ? "无noindex阻断" : c.kind === "public_third_party_page_changed" ? "第三方公开页实际变化" : "客户补充并确认材料"}</li>)}</ol>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || !dirty} onClick={() => void act(`${base}/${selected.id}`, { expectedRevision: selected.revision, title: selected.title, targetUrl: selected.targetUrl, position: selected.position, proposedText: text || null, conditions: selected.conditions }, "PUT")}>保存草稿新版本</Button><Button disabled={busy || dirty || selected.state !== "awaiting_approval"} onClick={() => action("approve")}>审核批准当前版本</Button></div>
      {selected.currentApprovalId && <div className="mt-5 flex flex-wrap items-end gap-3"><label className="field flex-1"><span>{project.isSynthetic ? "演练声明发布时间（UTC）" : "声明实际发布时间（UTC）"}</span><input className="rounded-md border p-2 text-sm" value={declaredAt} onChange={(e) => setDeclaredAt(e.target.value)} /></label><Button variant="secondary" disabled={busy || dirty} onClick={() => action("declare", { declaredPublishedAt: declaredAt })}>{selected.type === "third_party_correction" ? "申报第三方已发布，待独立核验" : "申报已发布，进入待核验"}</Button></div>}
      {release && <div className="mt-5 border-t pt-4"><h4 className="font-semibold">发布V{release.releaseVersion}的逐项核验</h4><p className="my-2 text-sm">声明于 {formatProjectDate(release.declaredPublishedAt)}；首次全部通过：{release.syntheticAllConditionsPassedAt ? `演练 ${formatProjectDate(release.syntheticAllConditionsPassedAt)}` : release.firstAllConditionsPassedAt ? formatProjectDate(release.firstAllConditionsPassedAt) : "尚未通过"}</p>{project.isSynthetic && <label className="field"><span>选择同一目标页面的合成快照</span><select className="mb-3 rounded-md border p-2 text-sm" value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)}><option value="">请选择（部分上线也可用于失败核验）</option>{collection?.fixtureSnapshots.filter((s) => s.url === selected.targetUrl).map((s) => <option key={s.id} value={s.id}>{s.id} · {formatProjectDate(s.observedAt)}</option>)}</select></label>}<Button disabled={busy || dirty || (project.isSynthetic && !snapshotId)} onClick={() => action("verify", { releaseId: release.id, source: project.isSynthetic ? "synthetic_fixture" : "live_public", ...(project.isSynthetic ? { snapshotId } : {}) })}>检查全部批准条件</Button>{selected.verifications.filter((v) => v.releaseId === release.id).map((v) => <div className="mt-3 rounded border p-3 text-sm" key={v.id}><strong>{v.allPassed ? "全部通过" : "尚未全部通过"} · {v.isSynthetic ? "演练" : "真实"} · {formatProjectDate(v.executedAt)}</strong>{v.checks.map((c) => <p className="mt-1" key={c.index}>{c.result === "passed" ? "✓" : c.result === "failed" ? "×" : "?"} {c.reason}</p>)}</div>)}</div>}
      <details className="mt-5 text-sm"><summary>任务取消与历史</summary><label className="field mt-3"><span>取消原因</span><input className="rounded-md border p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></label><Button variant="danger" size="small" disabled={busy || reason.trim().length < 8 || selected.state === "cancelled"} onClick={() => action("cancel", { reason })}>取消并保存原因</Button><p className="mt-3">审核 {selected.approvals.length} 次 · 发布 {selected.releases.length} 版 · 核验 {selected.verifications.length} 次；旧记录保留。</p></details>
    </article>}
  </section>;
}

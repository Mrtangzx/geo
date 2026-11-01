"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui/button";
import { formatProjectDate, projectApi } from "./project-api";
import { MonitoringPanel } from "./monitoring-panel";
import type { Project } from "@/lib/contracts";
import type { BudgetAccount, BudgetReservation, EvidenceRecord, FixturePeriod, SamplingRun } from "@/lib/sampling-contracts";
import type { AnalysisLabels, EvidenceAnalysis, MetricRate, MetricsSnapshot, RecommendationKind } from "@/lib/analysis-contracts";

export const periodNames: Record<string, string> = { baseline: "修改前基线", "review-1": "第一轮复查", "review-2": "第二轮复查", edge: "异常与边界" };
const recNames: Record<RecommendationKind, string> = { recommended: "明确推荐", mentioned: "仅提及", not_mentioned: "未提及", not_recommended: "明确不推荐", unknown: "无法判断" };
const runNames: Record<string, string> = { queued: "等待后台处理", running: "处理中", completed: "已完成", partial: "部分完成", failed: "未完成", needs_reconciliation: "费用待核对", paused: "已暂停", cancelled: "已取消" };
export function rateText(rate: MetricRate | undefined) { return !rate || rate.percent == null ? "暂无可判断数据" : `${rate.numerator}/${rate.denominator} · ${rate.percent.toFixed(2)}%`; }
const inputClass = "rounded-md border border-[#dfe5dc] bg-white p-2 text-sm";

export function SamplingPanel({ project }: { project: Project }) {
  const base = `/api/projects/${project.id}`;
  const [runs, setRuns] = useState<SamplingRun[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [analyses, setAnalyses] = useState<EvidenceAnalysis[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot[]>([]);
  const [accounts, setAccounts] = useState<BudgetAccount[]>([]);
  const [reservations, setReservations] = useState<BudgetReservation[]>([]);
  const [canConfigure, setCanConfigure] = useState(false);
  const [questionVersion, setQuestionVersion] = useState<number | null>(null);
  const [period, setPeriod] = useState<FixturePeriod>("baseline");
  const [mode, setMode] = useState("synthetic_fixture");
  const [scenario, setScenario] = useState("normal");
  const [newBatch, setNewBatch] = useState(false);
  const [limit, setLimit] = useState("20.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [selected, setSelected] = useState<EvidenceRecord | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationKind>("unknown");
  const [reason, setReason] = useState("");
  const [factLabels, setFactLabels] = useState<AnalysisLabels["factClaims"]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [s, e, a, b] = await Promise.all([
      projectApi<{ runs: SamplingRun[]; questionVersion: number | null; reservations: BudgetReservation[] }>(`${base}/sampling`, { signal }),
      projectApi<{ evidence: EvidenceRecord[] }>(`${base}/evidence`, { signal }),
      projectApi<{ analyses: EvidenceAnalysis[]; metrics: MetricsSnapshot[]; model: { message: string } }>(`${base}/analysis`, { signal }),
      projectApi<{ accounts: BudgetAccount[]; canConfigure: boolean }>("/api/budgets", { signal }),
    ]);
    if (signal?.aborted) return;
    setRuns(s.runs); setQuestionVersion(s.questionVersion); setReservations(s.reservations); setEvidence(e.evidence);
    setAnalyses(a.analyses); setMetrics(a.metrics); setModelMessage(a.model.message); setAccounts(b.accounts); setCanConfigure(b.canConfigure);
  }, [base]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal)).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "读取失败。"); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!runs.some((r) => ["queued", "running"].includes(r.status))) return;
    const timer = setInterval(() => { void load().catch(() => setError("后台状态读取未完成，可手动刷新；任务仍保存在数据库中。")); }, 2500);
    return () => clearInterval(timer);
  }, [runs, load]);

  async function act(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); await load(); setMessage(success); }
    catch (e) { setError(e instanceof Error ? e.message : "操作未完成。"); }
    finally { setBusy(false); }
  }
  function post(url: string, body: unknown, method = "POST") { return projectApi(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  function selectEvidence(row: EvidenceRecord) {
    setSelected(row); const previous = analyses.find((a) => a.evidenceId === row.id);
    setRecommendation(previous?.labels?.recommendation ?? "unknown"); setFactLabels(previous?.labels?.factClaims ?? []); setReason("");
  }
  const simulated = accounts.find((a) => a.kind === "simulation" && a.currency === "CNY");
  const latest = selected ? analyses.find((a) => a.evidenceId === selected.id) : null;
  return <>
    <section className="form-panel" aria-label="采样与回答证据">
      <div className="panel-heading"><div><h2>采样与回答证据</h2><p>先看覆盖与原文，再判断推荐和资料一致情况。</p></div><Button variant="secondary" disabled={busy} onClick={() => void act(() => load(), "已刷新。")}>刷新状态</Button></div>
      {error && <p role="alert" className="mb-4 text-red-800">{error}</p>}{message && <p role="status" className="mb-4 text-green-800">{message}</p>}
      <div className="synthetic-banner mb-4">{project.isSynthetic ? "合成演练 · 人工导入来源 · 历史日期不代表实际采样 · 不触发真实收费" : "真实消费端待配置与验收；不会自动切换成合成回答"}</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="field"><span>资料时期</span><select className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value as FixturePeriod)}>{Object.entries(periodNames).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
        {project.isSynthetic && <><label className="field"><span>运行方式</span><select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}><option value="synthetic_fixture">固定资料回放（无消耗）</option><option value="synthetic_operations">模拟采样与账本</option></select></label>{mode === "synthetic_operations" && <label className="field"><span>故障场景</span><select className={inputClass} value={scenario} onChange={(e) => setScenario(e.target.value)}><option value="normal">正常受理</option><option value="unknown_submission">提交结果不明</option><option value="retryable_not_accepted">明确未受理限流</option></select></label>}</>}
        <Button disabled={busy || !questionVersion} onClick={() => void act(() => post(`${base}/sampling`, { mode: project.isSynthetic ? mode : "real_domestic", period, questionVersion, purposes: ["manual"], operationScenario: scenario, ...(newBatch ? { batchKey: crypto.randomUUID(), newBatchConfirmed: true } : {}) }), "任务已持久保存。后台worker处理后可查看证据；重复点击复用相同执行。")}>发起{project.isSynthetic ? "合成回放" : "检查"}</Button>
      </div>
      {project.isSynthetic && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={newBatch} onChange={(e) => setNewBatch(e.target.checked)} />明确创建新执行批次（重新核算模拟消耗；相同原始资料不会变成新增样本）</label>}
      <p className="mt-3 text-sm text-[#68756c]">{mode === "synthetic_operations" && project.isSynthetic ? "每条预留模拟0.50元、正常结算0.40元；主周期30条预计上限15.00元。仅离线账本，无真实账单。" : "固定资料回放不消耗模拟或真实额度。真实通道、价格和使用条件仍待验证。"}</p>
      <div className="mt-5 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>时期与来源</th><th>后台状态</th><th>计划 / 已导入 / 有效</th><th>操作</th></tr></thead><tbody>{runs.map((run) => <tr className="border-t border-[#e6ebe3]" key={run.id}><td className="py-3">{periodNames[run.period]}<small className="block">{run.mode === "synthetic_fixture" ? "固定合成资料" : "独立模拟操作"} · {formatProjectDate(run.createdAt)}</small></td><td>{runNames[run.status]}{run.error && <p className="max-w-sm text-red-800">{run.error}</p>}</td><td>{run.plannedCount} / {run.importedCount} / {run.validCount}<small className="block">排除 {run.excludedCount} · 无效或失败 {run.failedCount}</small></td><td><div className="flex flex-wrap gap-1">{["queued", "running"].includes(run.status) && <Button size="small" variant="ghost" disabled={busy} onClick={() => void act(() => post(`${base}/sampling/${run.id}`, { action: "pause" }, "PATCH"), "已暂停未执行动作。")}>暂停</Button>}{run.status === "paused" && <Button size="small" disabled={busy} onClick={() => void act(() => post(`${base}/sampling/${run.id}`, { action: "resume" }, "PATCH"), "已恢复。")}>恢复</Button>}{run.status === "needs_reconciliation" && canConfigure && <Button size="small" variant="secondary" disabled={busy} onClick={() => void act(() => post(`${base}/sampling/${run.id}`, { action: "reconcile", accepted: true, actualMinor: 40, reason: "本机操作员依据离线模拟账单逐条确认受理及每条0.40元费用" }, "PATCH"), "模拟费用已核对，未重新提交采样。")}>核对模拟账单（每条0.40元）</Button>}</div></td></tr>)}</tbody></table>{!runs.length && <p className="py-5 text-[#68756c]">尚无采样任务。先确认问题，再显式选择运行方式。</p>}</div>
    </section>
    <section className="form-panel mt-6" aria-label="额度账本"><div className="panel-heading"><div><h2>额度与账本</h2><p>真实额度与模拟额度、币种分别保存；结果不明时保留预留。</p></div></div><div className="grid gap-3 sm:grid-cols-2">{accounts.map((a) => <div key={a.kind + a.currency} className="rounded-md border border-[#e0e6dc] p-3 text-sm"><strong>{a.kind === "real" ? "真实" : "模拟"} · {a.currency}</strong><p>上限 {(a.limitMinor / 100).toFixed(2)} · 可用 {(a.availableMinor / 100).toFixed(2)} · 预留 {(a.reservedMinor / 100).toFixed(2)} · 已结算 {(a.spentMinor / 100).toFixed(2)}</p></div>)}</div>{canConfigure && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="field"><span>模拟人民币预算上限</span><input className={inputClass} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" /></label><Button variant="secondary" disabled={busy || !/^\d+(\.\d{1,2})?$/.test(limit)} onClick={() => void act(() => post("/api/budgets", { kind: "simulation", currency: "CNY", limitMinor: Math.round(Number(limit) * 100), expectedVersion: simulated?.version ?? 0 }, "PATCH"), "模拟预算已更新；真实额度未改变。")}>设置模拟额度</Button></div>}<details className="mt-4 text-sm"><summary>查看逐笔预留与核对依据（{reservations.length}）</summary>{reservations.map((r) => <p className="border-t py-2" key={r.id}>{r.kind === "simulation" ? "模拟" : "真实"} · 预留 {(r.upperBoundMinor / 100).toFixed(2)} · 实际 {r.actualMinor == null ? "未知" : (r.actualMinor / 100).toFixed(2)} {r.currency} · {r.status} · {r.reason || "等待处理"}</p>)}</details></section>
    <section className="form-panel mt-6" aria-label="证据分析与指标"><div className="panel-heading"><div><h2>回答分析与指标</h2><p>{modelMessage}</p></div></div><div className="flex flex-wrap gap-3">{project.isSynthetic && <Button disabled={busy || !evidence.length} onClick={() => void act(() => post(`${base}/analysis`, { action: "replay", confirmSyntheticReference: true }), "已回放合成参考标注；这是固定标准答案，非真实模型输出。")}>显式回放合成参考标注</Button>}<Button variant="secondary" disabled={busy || !evidence.length} onClick={() => void act(() => post(`${base}/analysis`, { action: "metrics" }), "已保存新的指标快照，旧版本保留。")}>生成指标快照</Button></div>
      {metrics[0] && <div className="mt-5 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>范围</th><th>有效 / 计划</th><th>推荐</th><th>资料一致</th><th>官网正文引用</th></tr></thead><tbody>{metrics[0].overallByScope.map((g, i) => <tr className="border-t" key={i}><td className="py-3">{periodNames[g.scope.period] || g.scope.period}<small className="block">{g.scope.platform} · {g.scope.sourceType} · {g.scope.channelId}</small></td><td>{g.valid} / {g.planned ?? "未知"}</td><td>{rateText(g.recommendation)}<small className="block">判断覆盖 {rateText(g.recommendationCoverage)}</small></td><td>{rateText(g.facts)}<small className="block">冲突 {g.factCounts.conflict} / 未知 {g.factCounts.unknown}</small></td><td>{rateText(g.officialCitation)}<small className="block">引用覆盖 {rateText(g.citationCoverage)}</small></td></tr>)}</tbody></table></div>}
      {metrics[0] && <details className="mt-5 text-sm"><summary>按问题组查看分母、覆盖与未知项</summary><div className="overflow-auto"><table className="mt-3 w-full text-left"><thead><tr><th>时期 / 问题组</th><th>推荐</th><th>资料一致</th><th>官网引用</th><th>覆盖与未知</th></tr></thead><tbody>{metrics[0].groups.map((g, i) => <tr className="border-t" key={i}><td className="py-3">{periodNames[g.scope.period] || g.scope.period} / {{ industry_discovery: "行业发现", solution_comparison: "方案比较", brand_verification: "品牌核实" }[g.scope.group] || g.scope.group}</td><td>{rateText(g.recommendation)}</td><td>{rateText(g.facts)}</td><td>{rateText(g.officialCitation)}</td><td>有效 {rateText(g.validCoverage)}<br />推荐未知 {g.recommendationCounts.unknown} · 事实未知 {g.factCounts.unknown}<br />分析失败 {g.analysisFailed} · 未分析 {g.unanalysed}</td></tr>)}</tbody></table></div></details>}
      <h3 className="mt-6 font-semibold">回答原文（{evidence.length}）</h3><div className="mt-3 grid max-h-80 gap-2 overflow-auto">{evidence.filter((r) => r.period === period).map((row) => { const a = analyses.find((a) => a.evidenceId === row.id); return <button type="button" className="rounded-md border border-[#dfe5dc] p-3 text-left text-sm hover:bg-[#f5f7f3]" key={row.id} onClick={() => selectEvidence(row)}><strong>{row.sourceSampleId} · {row.questionText}</strong><span className="mt-1 block">{row.isValid ? a?.labels ? recNames[a.labels.recommendation] : "待分析" : "资料失败或不完整"} · {row.collectedAt ? formatProjectDate(row.collectedAt) : "采集时间未知"} · {row.sourceType}</span></button>; })}</div>
      {selected && <div className="mt-5 rounded-md border border-[#cddbc8] p-4"><div className="flex justify-between"><h3 className="font-semibold">{selected.sourceSampleId} 原文与版本</h3><Button size="small" variant="ghost" onClick={() => setSelected(null)}>关闭</Button></div><p className="my-3 whitespace-pre-wrap leading-7">{selected.answerText ?? "没有返回回答；失败不等于未提及。"}</p><p className="text-sm text-[#68756c]">{selected.platform} · {selected.channelId} · 问题V{selected.questionVersion} · 资料V{selected.projectVersion} · {selected.citations.status === "complete" ? "引用采集完整" : "引用未知或不支持"}</p><div className="my-3 text-sm">{selected.citations.bodyMappings?.length ? selected.citations.bodyMappings.map((c, i) => <p key={i}>正文引用：{c.quote} → {c.url}</p>) : <p>{selected.citations.status === "complete" ? "完整采集，确实没有正文引用。" : "缺少正文映射，不能当作无引用。"}</p>}{selected.sourceCandidates.map((s, i) => <p key={i}>仅来源候选：{s.url}</p>)}</div>
        {latest?.error && <p role="status" className="text-red-800">{latest.error.message}</p>}
        {latest?.labels?.factClaims.map((f, i) => <div className="my-3 border-t pt-3 text-sm" key={i}><blockquote>“{f.quote}”</blockquote><p>依据：{latest.projectSnapshot.facts.find((x) => x.id === f.factId)?.statement}</p><label>复核结论 <select className={inputClass} value={factLabels[i]?.verdict ?? f.verdict} onChange={(e) => setFactLabels((v) => v.map((c, j) => i === j ? { ...c, verdict: e.target.value as typeof c.verdict } : c))}><option value="consistent">一致</option><option value="conflict">冲突</option><option value="unknown">资料不足</option></select></label></div>)}
        <div className="mt-4 flex flex-wrap gap-3"><label className="field"><span>人工复核推荐判断</span><select className={inputClass} value={recommendation} onChange={(e) => setRecommendation(e.target.value as RecommendationKind)}>{Object.entries(recNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="field flex-1"><span>复核理由（留存操作者与版本）</span><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></label></div><div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy || !selected.isValid || reason.trim().length < 8} onClick={() => void act(() => post(`${base}/analysis`, { action: "analyse", evidenceId: selected.id, mode: "manual_review", expectedRevision: latest?.revision ?? 0, reason, labels: { recommendation, recommendationQuote: selected.answerText, recommendationUnknownReason: recommendation === "unknown" ? reason : null, factClaims: factLabels, questionSuggestions: [] } }), "人工复核已保存为新分析版本，请重新生成指标与报告。")}>保存人工复核新版本</Button><Button variant="secondary" disabled={busy} onClick={() => void act(() => post(`${base}/analysis`, { action: "analyse", evidenceId: selected.id, mode: "model", expectedRevision: latest?.revision ?? 0 }), "已记录真实模型配置检查；没有发起付费调用。")}>检查真实模型配置</Button></div>
      </div>}
    </section><MonitoringPanel projectId={project.id} />
  </>;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightIcon, FileTextIcon, ReloadIcon } from "@radix-ui/react-icons";
import { Button } from "./ui/button";
import { formatProjectDate, projectApi } from "./project-api";
import { MonitoringPanel } from "./monitoring-panel";
import { ManualImportPanel } from "./manual-import-panel";
import { EvidenceScreenshots } from "./evidence-screenshots";
import type { Project } from "@/lib/contracts";
import type { BudgetAccount, BudgetReservation, EvidenceRecord, FixturePeriod, SamplingRun } from "@/lib/sampling-contracts";
import type { AnalysisLabels, EvidenceAnalysis, MetricRate, MetricsSnapshot, RecommendationKind } from "@/lib/analysis-contracts";

export const periodNames: Record<string, string> = { baseline: "修改前基线", "review-1": "第一轮复查", "review-2": "第二轮复查", edge: "异常与边界" };
const recNames: Record<RecommendationKind, string> = { recommended: "明确推荐", mentioned: "仅提及", not_mentioned: "未提及", not_recommended: "明确不推荐", unknown: "无法判断" };
const runNames: Record<string, string> = { queued: "等待后台处理", running: "处理中", completed: "已完成", partial: "部分完成", failed: "未完成", needs_reconciliation: "费用待核对", paused: "已暂停", cancelled: "已取消" };
export function rateText(rate: MetricRate | undefined) { return !rate || rate.percent == null ? "暂无可判断数据" : `${rate.numerator}/${rate.denominator} · ${rate.percent.toFixed(2)}%`; }
const inputClass = "sampling-control";

export type SamplingView = "results" | "collect" | "operations" | "monitoring";
interface Props { project: Project; onManualDirtyChange: (dirty: boolean) => void; view?: SamplingView; onNavigate?: (view: SamplingView) => void }
export function SamplingPanel({ project, onManualDirtyChange, view = "results", onNavigate }: Props) {
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
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modelMessage, setModelMessage] = useState("");
  const [selected, setSelected] = useState<EvidenceRecord | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationKind>("unknown");
  const [reason, setReason] = useState("");
  const [quote, setQuote] = useState("");
  const [boundFacts, setBoundFacts] = useState<Project["facts"]>([]);
  const [factLabels, setFactLabels] = useState<AnalysisLabels["factClaims"]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [collectMethod, setCollectMethod] = useState("manual");
  const [importDirty, setImportDirty] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [pendingRow, setPendingRow] = useState<{ row: EvidenceRecord | null } | null>(null);
  const importDirtyChange = useCallback((value: boolean) => setImportDirty(value), []);
  useEffect(() => { onManualDirtyChange(importDirty || reviewDirty); }, [importDirty, reviewDirty, onManualDirtyChange]);
  useEffect(() => () => onManualDirtyChange(false), [onManualDirtyChange]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [s, e, a, b] = await Promise.all([
      projectApi<{ runs: SamplingRun[]; questionVersion: number | null; reservations: BudgetReservation[] }>(`${base}/sampling`, { signal }),
      projectApi<{ evidence: EvidenceRecord[] }>(`${base}/evidence`, { signal }),
      projectApi<{ analyses: EvidenceAnalysis[]; metrics: MetricsSnapshot[]; model: { message: string } }>(`${base}/analysis`, { signal }),
      projectApi<{ accounts: BudgetAccount[]; canConfigure: boolean }>("/api/budgets", { signal }),
    ]);
    if (signal?.aborted) return;
    setRuns(s.runs); setQuestionVersion(s.questionVersion); setReservations(s.reservations); setEvidence(e.evidence);
    setAnalyses(a.analyses); setMetrics(a.metrics); setModelMessage(a.model.message); setAccounts(b.accounts); setCanConfigure(b.canConfigure); setLoaded(true);
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

  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    projectApi<{ projectSnapshot: Project }>(`${base}/evidence/${selectedId}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setBoundFacts(result.projectSnapshot.facts); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "证据绑定的事实版本读取失败。"); });
    return () => controller.abort();
  }, [base, selectedId]);

  async function act(action: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true); setError(""); setMessage("");
    try { await action(); await load(); setMessage(success); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "操作未完成。"); return false; }
    finally { setBusy(false); }
  }
  function post(url: string, body: unknown, method = "POST") { return projectApi(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  function applyEvidence(row: EvidenceRecord | null) {
    setSelected(row); const previous = row ? analyses.find((a) => a.evidenceId === row.id) : null;
    setBoundFacts([]); setQuote(previous?.labels?.recommendationQuote ?? row?.answerText?.slice(0, 12000) ?? "");
    setReviewRevision(previous?.revision ?? 0);
    setRecommendation(previous?.labels?.recommendation ?? "unknown"); setFactLabels(previous?.labels?.factClaims ?? []); setReason("");
    setReviewDirty(false); setPendingRow(null);
  }
  function selectEvidence(row: EvidenceRecord | null) {
    if (row?.id === selected?.id) return;
    if (reviewDirty) { setPendingRow({ row }); return; }
    applyEvidence(row);
  }
  function changePeriod(nextPeriod: FixturePeriod) {
    setPeriod(nextPeriod);
    if (selected && selected.period !== nextPeriod && !reviewDirty) applyEvidence(null);
  }
  const simulated = accounts.find((a) => a.kind === "simulation" && a.currency === "CNY");
  const latest = selected ? analyses.find((a) => a.evidenceId === selected.id) : null;
  const periodEvidence = evidence.filter((row) => row.period === period);
  const validCount = periodEvidence.filter((row) => row.isValid).length;
  const analysedCount = periodEvidence.filter((row) => analyses.some((analysis) => analysis.evidenceId === row.id && analysis.status === "succeeded")).length;
  const filteredEvidence = periodEvidence.filter((row) => {
    const analysis = analyses.find((item) => item.evidenceId === row.id);
    if (search.trim() && ![row.questionText, row.sourceSampleId, row.platform].join(" ").toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filter === "unanalysed") return row.isValid && analysis?.status !== "succeeded";
    if (filter === "conflict") return !!analysis?.labels?.factClaims.some((claim) => claim.verdict === "conflict");
    if (filter === "incomplete") return !row.isValid;
    return true;
  });
  return <div className="sampling-workspace">
    {error && <p role="alert" className="sampling-feedback sampling-feedback-error">{error}</p>}{message && <p role="status" className="sampling-feedback">{message}</p>}
    <div className="sampling-source-note"><strong>{project.isSynthetic ? "合成演练" : "当前工作区"}</strong><span>{project.isSynthetic ? "回放保留合成来源和历史日期，不代表真实采样或优化效果。" : "人工证据与自动采样分别统计；运行前检查配置与预算。"}</span></div>
    <div hidden={view !== "collect"}>
      <div className="sampling-intro"><div><span className="sampling-kicker">01 / 保存回答</span><h2>选择资料来源</h2><p>保存原始回答后，再核对推荐判断与企业事实。</p></div>{onNavigate && <Button variant="secondary" onClick={() => onNavigate("results")}>查看回答结果<ArrowRightIcon /></Button>}</div>
      <div className="sampling-methods" aria-label="选择资料来源"><button type="button" aria-pressed={collectMethod === "manual"} onClick={() => setCollectMethod("manual")}><FileTextIcon /><span><strong>人工采集的回答</strong><small>粘贴原文或批量文件，预览后明确保存</small></span></button><button type="button" aria-pressed={collectMethod === "replay"} onClick={() => setCollectMethod("replay")}><ReloadIcon /><span><strong>{project.isSynthetic ? "合成资料回放" : "自动采样"}</strong><small>{project.isSynthetic ? "回放演练资料，不发起真实付费请求" : "使用已确认问题，配置与预算就绪后运行"}</small></span></button></div>
    </div>
    <div hidden={view !== "collect" || collectMethod !== "manual"}><ManualImportPanel project={project} onChanged={load} onDirtyChange={importDirtyChange} /></div>
    <section hidden={view !== "collect" || collectMethod !== "replay"} className="form-panel sampling-panel" aria-label="采样与回答证据">
      <div className="panel-heading"><div><h2>采样与回答证据</h2><p>先看覆盖与原文，再判断推荐和资料一致情况。</p></div><Button variant="secondary" disabled={busy} onClick={() => void act(() => load(), "已刷新。")}>刷新状态</Button></div>
      <div className="synthetic-banner mb-4">{project.isSynthetic ? "合成演练 · 人工导入来源 · 历史日期不代表实际采样 · 不触发真实收费" : "真实消费端待配置与验收；不会自动切换成合成回答"}</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="field"><span>资料时期</span><select className={inputClass} value={period} onChange={(e) => changePeriod(e.target.value as FixturePeriod)}>{Object.entries(periodNames).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
        {project.isSynthetic && <details className="sampling-run-options"><summary>更多演练选项</summary><div className="sampling-options-content"><label className="field"><span>运行方式</span><select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)}><option value="synthetic_fixture">固定资料回放（无消耗）</option><option value="synthetic_operations">模拟采样与账本</option></select></label>{mode === "synthetic_operations" && <label className="field"><span>故障场景</span><select className={inputClass} value={scenario} onChange={(e) => setScenario(e.target.value)}><option value="normal">正常受理</option><option value="unknown_submission">提交结果不明</option><option value="retryable_not_accepted">明确未受理限流</option></select></label>}</div></details>}
        <Button disabled={busy || !questionVersion} onClick={() => void act(() => post(`${base}/sampling`, { mode: project.isSynthetic ? mode : "real_domestic", period, questionVersion, purposes: ["manual"], operationScenario: scenario, ...(newBatch ? { batchKey: crypto.randomUUID(), newBatchConfirmed: true } : {}) }), "任务已持久保存。后台worker处理后可查看证据；重复点击复用相同执行。")}>发起{project.isSynthetic ? "合成回放" : "检查"}</Button>
      </div>
      {project.isSynthetic && <details className="sampling-details"><summary>需要独立的新执行批次？</summary><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={newBatch} onChange={(e) => setNewBatch(e.target.checked)} />明确创建新执行批次（重新核算模拟消耗；相同原始资料不会变成新增样本）</label></details>}
      <p className="mt-3 text-sm text-[#68756c]">{mode === "synthetic_operations" && project.isSynthetic ? "每条预留模拟0.50元、正常结算0.40元；主周期30条预计上限15.00元。仅离线账本，无真实账单。" : "固定资料回放不消耗模拟或真实额度。真实通道、价格和使用条件仍待验证。"}</p>
      <h3 className="sampling-section-title">运行记录与当前进度</h3><div className="sampling-table-wrap mt-5"><table className="w-full text-left text-sm"><thead><tr><th>时期与来源</th><th>后台状态</th><th>计划 / 已导入 / 有效</th><th>操作</th></tr></thead><tbody>{runs.map((run) => <tr className="border-t border-[#e6ebe3]" key={run.id}><td className="py-3">{periodNames[run.period]}<small className="block">{run.mode === "synthetic_fixture" ? "固定合成资料" : run.mode === "synthetic_operations" ? "独立模拟操作" : "真实消费端"} · {formatProjectDate(run.createdAt)}</small></td><td>{runNames[run.status]}{run.error && <p className="max-w-sm text-red-800">{run.error}</p>}</td><td>{run.plannedCount} / {run.importedCount} / {run.validCount}<small className="block">排除 {run.excludedCount} · 无效或失败 {run.failedCount}</small></td><td><div className="flex flex-wrap gap-1">{["queued", "running"].includes(run.status) && <Button size="small" variant="ghost" disabled={busy} onClick={() => void act(() => post(`${base}/sampling/${run.id}`, { action: "pause" }, "PATCH"), "已暂停未执行动作。")}>暂停</Button>}{run.status === "paused" && <Button size="small" disabled={busy} onClick={() => void act(() => post(`${base}/sampling/${run.id}`, { action: "resume" }, "PATCH"), "已恢复。")}>恢复</Button>}{run.status === "needs_reconciliation" && canConfigure && run.mode === "synthetic_operations" && <Button size="small" variant="secondary" disabled={busy} onClick={() => void act(() => post(`${base}/sampling/${run.id}`, { action: "reconcile", accepted: true, actualMinor: 40, reason: "本机操作员依据离线模拟账单逐条确认受理及每条0.40元费用" }, "PATCH"), "模拟费用已核对，未重新提交采样。")}>核对模拟账单（每条0.40元）</Button>}</div></td></tr>)}</tbody></table>{!runs.length && <p className="py-5 text-[#68756c]">尚无采样任务。先确认问题，再显式选择运行方式。</p>}</div>
    </section>
    <section hidden={view !== "operations"} className="form-panel sampling-panel" aria-label="额度账本"><div className="panel-heading"><div><h2>额度与账本</h2><p>真实额度与模拟额度、币种分别保存；结果不明时保留预留。</p></div></div><div className="grid gap-3 sm:grid-cols-2">{accounts.map((a) => <div key={a.kind + a.currency} className="rounded-md border border-[#e0e6dc] p-3 text-sm"><strong>{a.kind === "real" ? "真实" : "模拟"} · {a.currency}</strong><p>上限 {(a.limitMinor / 100).toFixed(2)} · 可用 {(a.availableMinor / 100).toFixed(2)} · 预留 {(a.reservedMinor / 100).toFixed(2)} · 已结算 {(a.spentMinor / 100).toFixed(2)}</p></div>)}</div>{canConfigure && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="field"><span>模拟人民币预算上限</span><input className={inputClass} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" /></label><Button variant="secondary" disabled={busy || !/^\d+(\.\d{1,2})?$/.test(limit)} onClick={() => void act(() => post("/api/budgets", { kind: "simulation", currency: "CNY", limitMinor: Math.round(Number(limit) * 100), expectedVersion: simulated?.version ?? 0 }, "PATCH"), "模拟预算已更新；真实额度未改变。")}>设置模拟额度</Button></div>}<details className="mt-4 text-sm"><summary>查看逐笔预留与核对依据（{reservations.length}）</summary>{reservations.map((r) => <p className="border-t py-2" key={r.id}>{r.kind === "simulation" ? "模拟" : "真实"} · 预留 {(r.upperBoundMinor / 100).toFixed(2)} · 实际 {r.actualMinor == null ? "未知" : (r.actualMinor / 100).toFixed(2)} {r.currency} · {r.status} · {r.reason || "等待处理"}</p>)}</details></section>
    <section hidden={view !== "results"} className="sampling-results" aria-label="证据分析与指标"><div className="sampling-intro"><div><span className="sampling-kicker">02 / 核对回答</span><h2>回答与指标</h2><p>选择观察时期，先核对原文，再生成可追溯的指标快照。</p></div><label className="field"><span>观察时期</span><select className={inputClass} value={period} onChange={(event) => changePeriod(event.target.value as FixturePeriod)}>{Object.entries(periodNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="sampling-summary"><div><span>已保存回答</span><strong>{loaded ? periodEvidence.length : "—"}<small>条</small></strong></div><div><span>完整有效</span><strong>{loaded ? validCount : "—"}<small>条</small></strong></div><div><span>已完成分析</span><strong>{loaded ? analysedCount : "—"}<small>条</small></strong></div><div><span>失败或不完整</span><strong>{loaded ? periodEvidence.length - validCount : "—"}<small>条</small></strong></div></div>
      {!loaded && !error && <div className="sampling-loading" role="status" aria-label="正在读取回答与指标"><span /><span /><span /></div>}{loaded && !periodEvidence.length && <div className="sampling-empty"><FileTextIcon /><h3>{periodNames[period]}还没有回答</h3><p>先采集或导入回答，保存原文后再核对判断。缺失资料不会按零计算。</p>{onNavigate && <Button onClick={() => onNavigate("collect")}>去采集资料<ArrowRightIcon /></Button>}</div>}
      <div className="form-panel sampling-panel"><div className="panel-heading"><div><h2>检查指标</h2><p>{metrics[0] ? `快照更新于 ${formatProjectDate(metrics[0].createdAt)}；不同平台和来源分别统计。` : "逐条核对分析后，生成首份指标快照。"}</p></div></div><div className="flex flex-wrap gap-3">{project.isSynthetic && <Button variant="secondary" disabled={busy || !evidence.length} onClick={() => void act(() => post(`${base}/analysis`, { action: "replay", confirmSyntheticReference: true }), "已回放合成参考标注；这是固定标准答案，非真实模型输出。")}>合成参考标注</Button>}<Button variant={metrics.length ? "secondary" : "primary"} disabled={busy || !evidence.length} onClick={() => void act(() => post(`${base}/analysis`, { action: "metrics" }), "已保存新的指标快照，旧版本保留。")}>{metrics.length ? "更新指标快照" : "生成指标快照"}</Button></div>
      {metrics[0] && <div className="mt-5 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>范围</th><th>有效 / 计划</th><th>推荐</th><th>资料一致</th><th>官网正文引用</th></tr></thead><tbody>{metrics[0].overallByScope.filter((g) => g.scope.period === period).map((g, i) => <tr className="border-t" key={i}><td className="py-3">{periodNames[g.scope.period] || g.scope.period}<small className="block">{g.scope.platform} · {g.scope.sourceType} · {g.scope.channelId}</small></td><td>{g.valid} / {g.planned ?? "未知"}</td><td>{rateText(g.recommendation)}<small className="block">判断覆盖 {rateText(g.recommendationCoverage)}</small></td><td>{rateText(g.facts)}<small className="block">冲突 {g.factCounts.conflict} / 未知 {g.factCounts.unknown}</small></td><td>{rateText(g.officialCitation)}<small className="block">引用覆盖 {rateText(g.citationCoverage)}</small></td></tr>)}</tbody></table></div>}
      {metrics[0] && <details className="mt-5 text-sm"><summary>按问题组查看分母、覆盖与未知项</summary><div className="overflow-auto"><table className="mt-3 w-full text-left"><thead><tr><th>时期 / 问题组</th><th>推荐</th><th>资料一致</th><th>官网引用</th><th>覆盖与未知</th></tr></thead><tbody>{metrics[0].groups.filter((g) => g.scope.period === period).map((g, i) => <tr className="border-t" key={i}><td className="py-3">{periodNames[g.scope.period] || g.scope.period} / {{ industry_discovery: "行业发现", solution_comparison: "方案比较", brand_verification: "品牌核实" }[g.scope.group] || g.scope.group}</td><td>{rateText(g.recommendation)}</td><td>{rateText(g.facts)}</td><td>{rateText(g.officialCitation)}</td><td>有效 {rateText(g.validCoverage)}<br />推荐未知 {g.recommendationCounts.unknown} · 事实未知 {g.factCounts.unknown}<br />分析失败 {g.analysisFailed} · 未分析 {g.unanalysed}</td></tr>)}</tbody></table></div></details>}
      <details className="sampling-details"><summary>分析方式与模型配置</summary><p className="sampling-help">{modelMessage}</p>{project.isSynthetic && <p className="sampling-help">合成参考标注是固定标准答案，不是实际模型输出；执行后请重新生成指标快照。</p>}</details></div>
      <div className="sampling-heading"><div><h2>逐条核对原文</h2><p>选择回答，查看判断、事实依据与引用。</p></div><span>{filteredEvidence.length} / {periodEvidence.length} 条</span></div>
      {pendingRow && <div className="sampling-discard" role="alert"><div><strong>还有未保存的复核修改</strong><p>可以继续编辑，或明确放弃后切换回答。</p></div><Button variant="secondary" onClick={() => setPendingRow(null)}>继续编辑</Button><Button variant="ghost" onClick={() => applyEvidence(pendingRow.row)}>放弃修改并切换</Button></div>}
      <div className="sampling-evidence-grid"><div className="sampling-evidence-list"><div className="sampling-filters"><label><span className="visually-hidden">搜索问题、编号或平台</span><input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索问题或平台" /></label><label><span className="visually-hidden">筛选回答状态</span><select className={inputClass} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部状态</option><option value="unanalysed">待完成分析</option><option value="conflict">存在事实冲突</option><option value="incomplete">失败或不完整</option></select></label></div><div className="sampling-evidence-items">{filteredEvidence.map((row) => { const a = analyses.find((a) => a.evidenceId === row.id); return <button type="button" className={`sampling-evidence-row${selected?.id === row.id ? " is-selected" : ""}`} aria-pressed={selected?.id === row.id} key={row.id} disabled={busy} onClick={() => selectEvidence(row)}><strong>{row.sourceSampleId} · {row.questionText}</strong><span className="mt-1 block">{row.isValid ? a?.labels ? recNames[a.labels.recommendation] : "待分析" : "资料失败或不完整"} · {row.collectedAt ? formatProjectDate(row.collectedAt) : "采集时间未知"} · {row.sourceType}</span></button>; })}{!filteredEvidence.length && <p className="sampling-help">没有匹配的回答，试试调整筛选条件。</p>}</div></div>
      <article className="sampling-evidence-detail">{!selected ? <div className="sampling-empty"><FileTextIcon /><h3>选择一条回答开始核对</h3><p>原文和引用是判断依据。人工复核会保存为新版本。</p></div> : <><div className="flex justify-between"><h3 className="font-semibold">{selected.sourceSampleId} · {periodNames[selected.period]}原文</h3><Button size="small" variant="ghost" disabled={busy} onClick={() => selectEvidence(null)}>关闭详情</Button></div>{selected.period !== period && <p role="status" className="sampling-period-notice">当前筛选为{periodNames[period]}；此处仍显示{periodNames[selected.period]}的原文。{reviewDirty ? "未保存的复核修改已保留，请先保存或关闭详情后明确放弃。" : "复核已保存，可关闭详情并选择当前时期的回答。"}</p>}<blockquote className="sampling-answer">{selected.answerText ?? "没有返回回答；失败不等于未提及。"}</blockquote><p className="text-sm text-[#68756c]">{selected.platform} · {selected.channelId} · 问题V{selected.questionVersion} · 资料V{selected.projectVersion} · {selected.citations.status === "complete" ? "引用采集完整" : "引用未知或不支持"}</p><div className="sampling-current-judgment"><strong>{latest?.labels ? recNames[latest.labels.recommendation] : "尚未形成有效判断"}</strong><span>{latest ? `分析 V${latest.revision} · ${latest.mode === "synthetic_reference" ? "合成参考标注" : latest.mode === "manual_review" ? "人工复核" : "模型分析"}` : "可展开人工复核，依据原文建立判断"}</span>{latest?.labels?.factClaims.map((claim, index) => <p key={index}>“{claim.quote}”<br />{claim.verdict === "consistent" ? "与资料一致" : claim.verdict === "conflict" ? "与资料冲突" : "资料不足"} · {latest.projectSnapshot.facts.find((fact) => fact.id === claim.factId)?.statement}</p>)}</div><div className="my-3 text-sm">{selected.citations.bodyMappings?.length ? selected.citations.bodyMappings.map((c, i) => <p key={i}>正文引用：{c.quote} → {c.url}</p>) : <p>{selected.citations.status === "complete" ? "完整采集，确实没有正文引用。" : "缺少正文映射，不能当作无引用。"}</p>}{selected.sourceCandidates.map((s, i) => <p key={i}>仅来源候选：{s.url}</p>)}</div>
        {selected.manualProvenance && <p className="my-3 text-sm">人工采集：{selected.manualProvenance.collectedBy} · 导入操作者：{selected.manualProvenance.importedBy}<br />出处回放链接：{selected.manualProvenance.sourceUrl || "未知"}（尚未检查可用性，截图和原文在平台持久保存）<br />采集说明：{selected.manualProvenance.notes || "未填写"}</p>}
        <EvidenceScreenshots key={selected.id} projectId={project.id} evidenceId={selected.id} onChanged={load} />
        {latest?.error && <p role="status" className="text-red-800">{latest.error.message}</p>}
        <details className="sampling-details sampling-review-editor"><summary>人工复核：调整推荐判断与事实标签{reviewDirty ? " · 尚未保存" : ""}</summary><fieldset className="sampling-review-fields" disabled={busy} onChangeCapture={() => setReviewDirty(true)}><div className="my-4"><h4 className="font-semibold">与证据所绑定企业事实逐项核对</h4>{factLabels.map((f, i) => <div className="my-3 grid gap-2 rounded-md border p-3 text-sm" key={i}>
          <label className="field"><span>对应企业事实</span><select className={inputClass} value={f.factId} onChange={(e) => setFactLabels((v) => v.map((c, j) => i === j ? { ...c, factId: e.target.value, verdict: "unknown" } : c))}>{boundFacts.map((fact) => <option key={fact.id} value={fact.id}>{fact.status === "confirmed" ? "已确认" : "待补资料"} · {fact.statement}</option>)}</select></label>
          <label className="field"><span>该业务陈述在回答中的原文片段</span><textarea className={inputClass} value={f.quote} onChange={(e) => setFactLabels((v) => v.map((c, j) => i === j ? { ...c, quote: e.target.value } : c))} /></label>
          <label className="field"><span>事实核对结论</span><select className={inputClass} value={f.verdict} onChange={(e) => setFactLabels((v) => v.map((c, j) => i === j ? { ...c, verdict: e.target.value as typeof c.verdict } : c))}><option value="consistent" disabled={boundFacts.find((x) => x.id === f.factId)?.status !== "confirmed"}>一致</option><option value="conflict" disabled={boundFacts.find((x) => x.id === f.factId)?.status !== "confirmed"}>冲突</option><option value="unknown">资料不足</option></select></label>
          <label className="field"><span>逐项核对理由</span><input className={inputClass} value={f.reason} onChange={(e) => setFactLabels((v) => v.map((c, j) => i === j ? { ...c, reason: e.target.value } : c))} /></label>
          <Button size="small" variant="ghost" onClick={() => { setFactLabels((v) => v.filter((_, j) => i !== j)); setReviewDirty(true); }}>移除此项事实核对</Button>
        </div>)}<Button variant="secondary" size="small" disabled={busy || !boundFacts.length || factLabels.length >= 200} onClick={() => { setFactLabels((v) => [...v, { factId: boundFacts[0].id, quote: "", verdict: "unknown", reason: "" }]); setReviewDirty(true); }}>添加一项事实核对</Button><p className="mt-2 text-sm text-[#68756c]">只核对实际提到的业务陈述。未提到不计正确；待补事实只能保持资料不足。</p></div>
        <label className="field mt-3"><span>推荐判断依据（回答原文片段，最多12000字）</span><textarea className={inputClass} maxLength={12000} value={quote} onChange={(e) => setQuote(e.target.value)} /></label>
        <div className="mt-4 flex flex-wrap gap-3"><label className="field"><span>人工复核推荐判断</span><select className={inputClass} value={recommendation} onChange={(e) => setRecommendation(e.target.value as RecommendationKind)}>{Object.entries(recNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="field flex-1"><span>复核理由（留存操作者与版本）</span><input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></label></div><div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy || !selected.isValid || !quote.trim() || reason.trim().length < 8} onClick={() => void act(() => post(`${base}/analysis`, { action: "analyse", evidenceId: selected.id, mode: "manual_review", expectedRevision: reviewRevision, reason, labels: { recommendation, recommendationQuote: quote, recommendationUnknownReason: recommendation === "unknown" ? reason : null, factClaims: factLabels, questionSuggestions: [] } }), "人工复核已保存为新分析版本，请重新生成指标与报告。").then((saved) => { if (saved) { setReviewDirty(false); setReviewRevision((revision) => revision + 1); } })}>保存人工复核新版本</Button></div></fieldset></details><details className="sampling-details"><summary>模型配置检查</summary><p className="sampling-help">{modelMessage}</p><div><Button variant="secondary" disabled={busy || reviewDirty} onClick={() => void act(() => post(`${base}/analysis`, { action: "analyse", evidenceId: selected.id, mode: "model", expectedRevision: latest?.revision ?? 0 }), "模型请求已记录，请核对返回状态与费用。")}>检查真实模型配置</Button></div></details>
      </>}</article></div>
    </section><div hidden={view !== "monitoring"}><MonitoringPanel projectId={project.id} /></div>
  </div>;
}

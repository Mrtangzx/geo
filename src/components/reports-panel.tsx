"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReportSummary, ReviewReport } from "@/lib/report-contracts";
import type { MetricsSnapshot } from "@/lib/analysis-contracts";
import { projectApi, formatProjectDate } from "./project-api";
import { Button } from "./ui/button";
import { periodNames, rateText } from "./sampling-panel";

export function ReportsPanel({ projectId }: { projectId: string }) {
  const base = `/api/projects/${projectId}`;
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await projectApi<{ reports: ReportSummary[] }>(`${base}/reports`, { signal });
    if (!signal?.aborted) setReports(r.reports);
  }, [base]);
  useEffect(() => { const c = new AbortController(); Promise.resolve().then(() => load(c.signal)).catch((e: unknown) => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "报告读取失败。"); }); return () => c.abort(); }, [load]);
  async function create() {
    setBusy(true); setError("");
    try {
      const m = await projectApi<{ metrics: MetricsSnapshot }>(`${base}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "metrics" }) });
      const r = await projectApi<{ report: ReviewReport }>(`${base}/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metricsSnapshotId: m.metrics.id }) });
      setReport(r.report); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "报告尚未生成。"); }
    finally { setBusy(false); }
  }
  async function view(id: string) {
    setBusy(true); setError("");
    try { setReport((await projectApi<{ report: ReviewReport }>(`${base}/reports/${id}`)).report); }
    catch (e) { setError(e instanceof Error ? e.message : "报告读取失败。"); }
    finally { setBusy(false); }
  }
  return <section className="form-panel" aria-label="复查报告"><div className="panel-heading"><div><h2>复查与变化报告</h2><p>绑定证据、标注与发布版本，保留未知、无变化和负向结果。</p></div><Button disabled={busy} onClick={() => void create()}>生成报告新版本</Button></div>{error && <p role="alert" className="my-3 text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">{reports.map((r) => <Button key={r.id} variant="secondary" size="small" disabled={busy} onClick={() => void view(r.id)}>V{r.version} · {r.isSynthetic ? "合成" : "观察"} · {formatProjectDate(r.createdAt)}</Button>)}</div>
    {!report && <p className="py-8 text-[#68756c]">生成报告后可查看前后指标、实际窗口、缺失原因和下一步。每次生成都保留独立版本。</p>}
    {report && <article className="mt-5"><h3 className="text-lg font-semibold">{report.projectSnapshot.name} · 报告V{report.version}</h3><ul className="my-4 list-inside list-disc space-y-2 text-sm text-[#68756c]">{report.notes.map((n, i) => <li key={i}>{n}</li>)}</ul><div className="mb-5 flex gap-3"><a className="button button-secondary button-small" href={`${base}/reports/${report.id}/download?format=html`}>下载 HTML 报告</a><a className="button button-secondary button-small" href={`${base}/reports/${report.id}/download?format=json`}>下载证据与版本 JSON</a></div>
      <h4 className="font-semibold">发布与复查窗口</h4>{report.windows.length ? report.windows.map((w) => <p className="my-2 text-sm" key={w.releaseId}>发布V{w.releaseVersion} · {w.isSynthetic ? "演练" : "真实"} · {w.superseded ? "旧发布已替代" : w.verifiedAt ? `首次核验：${formatProjectDate(w.verifiedAt)}；第一轮 ${w.firstDates.join(" / ")}；第二轮 ${w.secondDates.join(" / ")}` : "尚未全部核验通过，不能起算窗口"}</p>) : <p className="my-2 text-sm">尚无发布记录，只有观察数据。</p>}
      {report.comparisons.map((c) => <section className="mt-5 rounded-md border border-[#dfe5dc] p-4" key={c.id}><h4 className="font-semibold">{periodNames[c.period] || c.period} · {c.group === "all" ? "全体问题" : c.group}</h4><p className="my-2 text-sm">{c.platform} · {c.sourceType} · {c.channelId} · 共同问题 {c.questionIntersection.length} · {c.status === "comparable" ? "条件可比，变化不代表因果" : "仅供观察，暂不能完整比较"}</p><div className="grid gap-3 text-sm sm:grid-cols-3"><div>明确推荐<p>{rateText(c.baseline?.recommendation)} → {rateText(c.review?.recommendation)}</p></div><div>与确认资料一致<p>{rateText(c.baseline?.facts)} → {rateText(c.review?.facts)}</p></div><div>官网正文引用<p>{rateText(c.baseline?.officialCitation)} → {rateText(c.review?.officialCitation)}</p></div></div><p className="mt-3 text-sm">基线日期：{c.baselineDates.join(" / ") || "缺失"}<br />复查日期：{c.reviewDates.join(" / ") || "缺失"}</p><ul className="my-3 list-inside list-disc space-y-1 text-sm text-[#68756c]">{c.limitations.map((l, i) => <li key={i}>{l}</li>)}{c.exclusions.map((x, i) => <li key={`e${i}`}>排除：{x.reason}</li>)}</ul><p className="text-sm font-medium">下一步：{c.nextActions.join("；")}</p></section>)}
      <details className="mt-5 text-sm"><summary>保留逐条推荐分布与原文（{report.analyses.length}个分析版本）</summary>{report.analyses.map((a) => <blockquote className="my-2 border-l-2 border-[#c9d9c3] pl-3" key={a.id}>{a.evidenceSnapshot.sourceSampleId} · {a.labels?.recommendation || a.status}：“{a.evidenceSnapshot.answerText || "未返回"}”</blockquote>)}</details>
    </article>}
  </section>;
}

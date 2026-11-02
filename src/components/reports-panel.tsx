"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightIcon, DownloadIcon, FileTextIcon, PlusIcon } from "@radix-ui/react-icons";
import type { ReportSummary, ReviewReport } from "@/lib/report-contracts";
import type { MetricRate, MetricsSnapshot } from "@/lib/analysis-contracts";
import { projectApi, formatProjectDate } from "./project-api";
import { Button } from "./ui/button";

const periods: Record<string, string> = { baseline: "修改前基线", "review-1": "第一轮复查", "review-2": "第二轮复查", edge: "异常与边界" };
const groups: Record<string, string> = { all: "全体问题", industry_discovery: "行业发现", solution_comparison: "方案比较", brand_verification: "品牌核实" };
const metricNames = { recommendation: "明确推荐", facts: "与确认资料一致", officialCitation: "官网正文引用" };
function rate(rate: MetricRate | undefined) { return !rate || rate.percent == null ? "暂无可判断数据" : `${rate.percent.toFixed(2)}% · ${rate.numerator}/${rate.denominator ?? "未知"}`; }

export function ReportsPanel({ projectId, onNavigate }: { projectId: string; onNavigate?: (section: "checks" | "tasks") => void }) {
  const base = `/api/projects/${projectId}`;
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [period, setPeriod] = useState("review-1");
  const [group, setGroup] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await projectApi<{ reports: ReportSummary[] }>(`${base}/reports`, { signal });
    if (!signal?.aborted) setReports(result.reports);
    return result.reports;
  }, [base]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal)).then(async (items) => {
      if (controller.signal.aborted || !items.length) return;
      const result = await projectApi<{ report: ReviewReport }>(`${base}/reports/${items[0].id}`, { signal: controller.signal });
      if (!controller.signal.aborted) setReport(result.report);
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "报告读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, base]);
  async function create() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const metrics = await projectApi<{ metrics: MetricsSnapshot }>(`${base}/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "metrics" }) });
      const result = await projectApi<{ report: ReviewReport }>(`${base}/reports`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metricsSnapshotId: metrics.metrics.id }) });
      setReport(result.report); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "报告尚未生成。"); }
    finally { setBusy(false); }
  }
  async function view(id: string) {
    if (busy || id === report?.id) return;
    setBusy(true); setError("");
    try { setReport((await projectApi<{ report: ReviewReport }>(`${base}/reports/${id}`)).report); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "报告读取失败。"); }
    finally { setBusy(false); }
  }
  const comparable = report?.comparisons.filter((comparison) => comparison.status === "comparable").length ?? 0;
  const synthetic = report?.evidence.some((evidence) => evidence.isSynthetic);
  const availableGroups = [...new Set(report?.comparisons.filter((comparison) => comparison.period === period).map((comparison) => comparison.group) ?? [])];
  const selectedGroup = availableGroups.includes(group) ? group : (availableGroups[0] ?? "all");
  const comparisons = report?.comparisons.filter((comparison) => comparison.period === period && comparison.group === selectedGroup) ?? [];
  return <section className="workflow-area" aria-label="复查报告">
    <div className="workflow-heading"><div><span className="workflow-kicker">持续观察</span><h2>看清变化，也看清依据</h2><p>先核对覆盖与可比条件，再看前后指标。</p></div><Button disabled={busy || loading} onClick={() => void create()}><PlusIcon />{busy ? "正在处理…" : "生成报告新版本"}</Button></div>
    {error && <div role="alert" className="workflow-feedback workflow-feedback-error">{error}</div>}
    {loading ? <div className="workflow-loading" role="status" aria-label="正在读取报告"><div /><div /><div /></div> : <div className="workflow-split workflow-report-split">
      <aside className="workflow-list-pane" aria-label="报告版本"><div className="workflow-list-title"><h3>报告版本 <span>{reports.length}</span></h3><span>历史独立保留</span></div>
        <div className="workflow-list">{reports.map((item, index) => <button key={item.id} type="button" className={`workflow-list-row ${report?.id === item.id ? "is-selected" : ""}`} disabled={busy} aria-pressed={report?.id === item.id} onClick={() => void view(item.id)}><span className="workflow-row-meta"><span>REPORT V{String(item.version).padStart(2, "0")}</span>{index === 0 && <span>最新</span>}</span><strong>{item.isSynthetic ? "合成演练报告" : "复查观察报告"}</strong><span className="workflow-row-position">{formatProjectDate(item.createdAt)}</span><span className="workflow-row-footer"><span className="workflow-state">{item.comparableCount ? `${item.comparableCount}组条件可比` : "观察数据"}</span><ArrowRightIcon /></span></button>)}</div>
        {!reports.length && <p className="workflow-inline-empty">尚无已保存的报告。生成后会在这里保留每个版本。</p>}
        <p className="workflow-list-help">纠正标签后生成新版本，旧报告仍指向原来的证据与计算依据。</p>
      </aside>
      {report ? <article className="workflow-detail" aria-label="当前报告详情"><div className="workflow-detail-top"><div><span className="workflow-kicker">报告 V{report.version} · {formatProjectDate(report.createdAt)}</span><h3>{report.projectSnapshot.name}</h3></div><span className="workflow-state">{synthetic ? "合成演练" : "复查观察"}</span></div>
        <section className="workflow-next workflow-report-conclusion"><span className="workflow-kicker">当前结论</span><h4>{synthetic ? "合成数据仅用于流程与计算演练" : comparable ? "部分范围满足前后比较条件" : "覆盖与条件仍需补齐，先保留观察数据"}</h4><p>{synthetic ? "来源、历史日期与人工参考标注都有独立标识，不作为真实优化效果。" : comparable ? `${comparable}个范围条件可比。各范围的排除、未知及限制单独保留，变化不代表因果关系。` : "缺失样本、未通过的上线条件和未知采样配置会限制结论；请查看下方具体原因。"}</p>{onNavigate && <div className="workflow-actions"><Button variant="secondary" onClick={() => onNavigate("checks")}>核对回答与覆盖<ArrowRightIcon /></Button><Button variant="ghost" onClick={() => onNavigate("tasks")}>查看修改与核验</Button></div>}</section>
        <div className="workflow-report-tools"><p>资料 V{report.projectSnapshot.version} · {report.metricsSnapshot.calculationVersion} / {report.calculationVersion}</p><div className="workflow-actions"><a className="button button-secondary" href={`${base}/reports/${report.id}/download?format=html`}><DownloadIcon />下载报告</a><a className="button button-ghost" href={`${base}/reports/${report.id}/download?format=json`}>导出证据 JSON</a></div></div>
        <section className="workflow-section"><div className="workflow-section-heading"><h4>前后指标</h4><span>时期与问题组分别查看</span></div><div className="workflow-comparison-controls"><div className="workflow-period-tabs" aria-label="复查时期">{["review-1", "review-2"].map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{periods[value]}</button>)}</div><label className="field"><span className="visually-hidden">报告问题组</span><select value={selectedGroup} onChange={(event) => setGroup(event.target.value)} disabled={!availableGroups.length}>{availableGroups.map((value) => <option key={value} value={value}>{groups[value] || value}</option>)}</select></label></div>
          {comparisons.length ? comparisons.map((comparison) => <section className="workflow-comparison" key={comparison.id}><div className="workflow-comparison-scope"><h5>{groups[comparison.group] || comparison.group}</h5><span className={`workflow-state ${comparison.status === "comparable" ? "" : "is-attention"}`}>{comparison.status === "comparable" ? "条件可比" : "仅供观察"}</span></div><p className="workflow-meta">{comparison.platform} · {comparison.sourceType} · {comparison.channelId} · 共同问题 {comparison.questionIntersection.length}个</p>
            <div className="workflow-table-wrap"><table className="workflow-metric-table"><thead><tr><th>指标</th><th>基线</th><th>本轮复查</th><th>变化（百分点）</th></tr></thead><tbody>{(["recommendation", "facts", "officialCitation"] as const).map((metric) => { const change = comparison.changes.find((item) => item.metric === metric); return <tr key={metric}><th>{metricNames[metric]}</th><td>{rate(comparison.baseline?.[metric])}</td><td>{rate(comparison.review?.[metric])}</td><td>{change?.percentagePoints == null ? "暂不能比较" : `${change.percentagePoints > 0 ? "+" : ""}${change.percentagePoints.toFixed(2)}`}</td></tr>; })}</tbody></table></div>
            <div className="workflow-observation-dates"><p><span>基线日期</span>{comparison.baselineDates.join(" · ") || "缺失"}</p><p><span>复查日期</span>{comparison.reviewDates.join(" · ") || "缺失"}</p></div>
            <div className="workflow-report-limits"><h5>结论范围与限制</h5><ul>{comparison.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></div>
            <div className="workflow-next-action"><span>下一步</span><p>{comparison.nextActions.join("；")}</p></div>
            <details className="workflow-disclosure"><summary><span>样本覆盖、未知与排除</span><span className="workflow-summary-meta">{comparison.exclusions.length}项排除</span></summary><div className="workflow-disclosure-body">{comparison.baseline && <p>基线：有效 {comparison.baseline.valid} / 计划 {comparison.baseline.planned ?? "未知"}；推荐判断覆盖 {rate(comparison.baseline.recommendationCoverage)}；引用采集覆盖 {rate(comparison.baseline.citationCoverage)}。</p>}{comparison.review && <p>复查：有效 {comparison.review.valid} / 计划 {comparison.review.planned ?? "未知"}；推荐未知 {comparison.review.recommendationCounts.unknown}；事实未知 {comparison.review.factCounts.unknown}；失败 {comparison.review.failed}；缺失 {comparison.review.missing ?? "未知"}。</p>}{comparison.exclusions.map((excluded, index) => <p key={index}>排除问题 {excluded.questionId}：{excluded.reason}</p>)}</div></details>
          </section>) : <p className="workflow-inline-empty">当前时期尚无可展示的比较范围。请先核对对应窗口的样本与分析。</p>}
        </section>
        <details className="workflow-disclosure"><summary><span>发布与复查窗口</span><span className="workflow-summary-meta">{report.windows.length}个发布记录</span></summary><div className="workflow-disclosure-body">{report.windows.length ? report.windows.map((window) => <div className="workflow-window" key={window.releaseId}><strong>发布 V{window.releaseVersion} · {window.isSynthetic ? "合成演练" : "实际核验"}{window.superseded ? " · 已替代" : ""}</strong><p>{window.verifiedAt ? `首次全部通过：${formatProjectDate(window.verifiedAt)}` : "尚未全部核验通过，不能起算观察窗口"}</p>{window.verifiedAt && <><p>第一轮：{window.firstDates.join(" · ")}</p><p>第二轮：{window.secondDates.join(" · ")}</p></>}</div>) : <p>尚无发布记录，当前仅有观察数据。</p>}</div></details>
        <details className="workflow-disclosure"><summary><span>报告说明与版本依据</span><span className="workflow-summary-meta">资料、标注与计算快照</span></summary><div className="workflow-disclosure-body"><ul className="workflow-plain-list">{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul><p className="workflow-meta">报告ID：{report.id}<br />指标快照：{report.metricsSnapshot.id}<br />项目时区：{report.timezone}</p></div></details>
        <details className="workflow-disclosure"><summary><FileTextIcon /><span>逐条回答与分析版本</span><span className="workflow-summary-meta">{report.analyses.length}个分析版本</span></summary><div className="workflow-disclosure-body workflow-evidence-history">{report.analyses.map((analysis) => <blockquote key={analysis.id}><strong>{analysis.evidenceSnapshot.sourceSampleId} · 分析 V{analysis.revision} · {analysis.labels?.recommendation || analysis.status}</strong><p>{analysis.evidenceSnapshot.answerText || "未返回回答"}</p></blockquote>)}</div></details>
      </article> : <div className="workflow-empty"><FileTextIcon /><h3>建立一份可回看的观察记录</h3><p>生成报告会保存当前指标和证据版本。样本不足时，也会如实展示待补条件。</p>{onNavigate && <Button variant="secondary" onClick={() => onNavigate("checks")}>先核对检查结果<ArrowRightIcon /></Button>}</div>}
    </div>}
  </section>;
}

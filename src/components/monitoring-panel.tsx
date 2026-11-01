"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatProjectDate, projectApi } from "@/components/project-api";
import type { MonitoringOccurrence, MonitoringPlan, MonitoringState } from "@/lib/monitoring-contracts";

interface Prerequisites {
  projectVersion: number; questionVersion: number | null; questionDraftPending: boolean;
  pageCollectionVersion: number; timezone: string; isSynthetic: boolean;
}
const controlClass = "w-full rounded-md border border-[#dfe5dc] bg-white px-3 py-2 text-sm";
const purposeLabels = { baseline: "基线", focus: "重点问题", full: "全量问题", "review-1": "第一轮复查", "review-2": "第二轮复查" };
const stateLabels = { planned: "计划中", dispatched: "已发起", missed: "已错过", paused: "已暂停", cancelled: "已取消", blocked: "等待前提" };

export function MonitoringPanel({ projectId }: { projectId: string }) {
  const url = `/api/projects/${encodeURIComponent(projectId)}/monitoring`;
  const [plans, setPlans] = useState<MonitoringPlan[]>([]);
  const [prerequisites, setPrerequisites] = useState<Prerequisites | null>(null);
  const [date, setDate] = useState("");
  const [detail, setDetail] = useState<{ plan: MonitoringPlan; occurrences: MonitoringOccurrence[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await projectApi<{ plans: MonitoringPlan[]; prerequisites: Prerequisites }>(url, { signal });
    if (signal?.aborted) return;
    setPlans(result.plans); setPrerequisites(result.prerequisites);
    setDate((value) => value || new Intl.DateTimeFormat("en-CA", { timeZone: result.prerequisites.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  }, [url]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal)).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "监测计划读取失败。"); });
    return () => controller.abort();
  }, [load]);

  async function create() {
    if (busy || !prerequisites?.questionVersion) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await projectApi(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        expectedProjectVersion: prerequisites.projectVersion, questionVersion: prerequisites.questionVersion,
        expectedPageCollectionVersion: prerequisites.pageCollectionVersion, firstBaselineDate: date,
        timezone: prerequisites.timezone, repeatsPerDay: 1, mode: prerequisites.isSynthetic ? "synthetic_fixture" : "real_domestic", channelConfigVersion: "config-v1",
      }) });
      setMessage(prerequisites.isSynthetic ? "演练计划已冻结。历史合成回答仍需在采样区明确回放，不会自动成为实际日期基线。" : "监测计划已冻结，执行前会检查通道配置和预算。");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "计划未创建。"); }
    finally { setBusy(false); }
  }

  async function change(plan: MonitoringPlan, state: MonitoringState) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await projectApi(`${url}/${plan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: plan.revision, state }) });
      await load();
      setMessage("计划状态已更新。已受理的供应商任务仍会继续查询和计账。");
      if (detail?.plan.id === plan.id) setDetail(await projectApi(`${url}/${plan.id}`));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "状态未更新。"); }
    finally { setBusy(false); }
  }

  async function view(plan: MonitoringPlan) {
    setBusy(true); setError("");
    try { setDetail(await projectApi(`${url}/${plan.id}`)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "计划详情读取失败。"); }
    finally { setBusy(false); }
  }

  return <section className="form-panel mt-6" aria-label="基线与周期监测">
    <div className="panel-heading"><div><h2>基线与周期监测</h2><p>资料和问题先冻结；按项目时区保存计划与实际执行记录。</p></div></div>
    {error && <p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="mb-3 text-sm text-green-800">{message}</p>}
    <p className="mb-4 text-sm leading-6 text-[#68756c]">Asia/Shanghai · 基线跨三个日期；重点问题每周二、五，全量每周日。错过48小时内仅补最近一次，实际采集时间独立记录。</p>
    {prerequisites && <div className="flex flex-wrap items-end gap-3">
      <label className="field min-w-48"><span>基线开始日期</span><input type="date" className={controlClass} value={date} onChange={(event) => setDate(event.target.value)} disabled={busy} /></label>
      <Button type="button" onClick={() => void create()} disabled={busy || !prerequisites.questionVersion || !prerequisites.pageCollectionVersion || prerequisites.questionDraftPending || plans.some((p) => p.state === "active")}>冻结并建立{prerequisites.isSynthetic ? "演练" : "监测"}计划</Button>
      <small className="text-xs text-[#68756c]">资料V{prerequisites.projectVersion} · 问题{prerequisites.questionVersion ? `V${prerequisites.questionVersion}` : "待确认"} · 页面V{prerequisites.pageCollectionVersion}</small>
    </div>}
    {prerequisites?.questionDraftPending && <p className="mt-3 text-sm text-amber-800">请先在品牌资料页保存并确认问题版本。</p>}
    {prerequisites?.pageCollectionVersion === 0 && <p className="mt-3 text-sm text-amber-800">请先保存需要检查的公开页面，再绑定页面版本。</p>}
    <div className="mt-5 space-y-3">{plans.map((plan) => <article key={plan.id} className="rounded border border-[#e4e9e0] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm">{plan.firstBaselineDate} 开始 · {plan.state === "active" ? "运行中" : plan.state === "paused" ? "已暂停" : "已取消"}</strong><p className="mt-1 text-xs text-[#68756c]">{plan.questionIds.length}题 × 每日{plan.repeatsPerDay}次 · {plan.timezone} · {plan.isSynthetic ? "合成演练，未建立真实基线" : "真实基线待实际样本核验"}</p></div>
        <div className="flex gap-2"><Button variant="ghost" size="small" disabled={busy} onClick={() => void view(plan)}>查看日历</Button>{plan.state !== "cancelled" && <><Button variant="secondary" size="small" disabled={busy} onClick={() => void change(plan, plan.state === "active" ? "paused" : "active")}>{plan.state === "active" ? "暂停计划" : "恢复计划"}</Button><Button variant="ghost" size="small" disabled={busy} onClick={() => void change(plan, "cancelled")}>取消计划</Button></>}</div>
      </div>
    </article>)}</div>
    {detail && <div className="mt-5 overflow-x-auto"><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">计划日历 · {detail.plan.firstBaselineDate}</h3><Button variant="ghost" size="small" onClick={() => setDetail(null)}>收起日历</Button></div><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="p-2">计划时间（项目时区）</th><th className="p-2">用途</th><th className="p-2">状态</th><th className="p-2">执行说明</th></tr></thead><tbody>{detail.occurrences.map((item) => <tr key={item.id} className="border-b border-[#edf0e9]"><td className="p-2">{formatProjectDate(item.scheduledAt)}</td><td className="p-2">{purposeLabels[item.purpose]}</td><td className="p-2">{stateLabels[item.state]}</td><td className="max-w-80 p-2">{item.reason || (detail.plan.isSynthetic ? "仅演练日历；回放保留原始合成日期。" : "执行前校验配置与预算。")}</td></tr>)}</tbody></table></div>}
  </section>;
}

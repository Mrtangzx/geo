"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, CheckIcon, ClockIcon, FileTextIcon, MixerHorizontalIcon, ReloadIcon } from "@radix-ui/react-icons";
import type { Project } from "@/lib/contracts";
import type { ModificationTask, TaskCollection, TaskState, VerificationCondition } from "@/lib/task-contracts";
import { Button } from "./ui/button";
import { formatProjectDate, projectApi } from "./project-api";

const states: Record<TaskState, string> = { needs_material: "待补资料", awaiting_approval: "待审核", awaiting_publication: "待发布", waiting_external: "等待外部处理", awaiting_verification: "待核验", verified_pending_review: "已上线待复查", synthetic_verified_pending_review: "演练核验通过待复查", reviewed: "已复查", synthetic_reviewed: "演练已复查", cancelled: "已取消" };
const filters = [
  { id: "all", label: "全部", states: null },
  { id: "prepare", label: "待准备", states: ["needs_material", "awaiting_approval"] },
  { id: "publish", label: "待上线", states: ["awaiting_publication", "waiting_external", "awaiting_verification"] },
  { id: "review", label: "待复查", states: ["verified_pending_review", "synthetic_verified_pending_review"] },
  { id: "finished", label: "已归档", states: ["reviewed", "synthetic_reviewed", "cancelled"] },
] as const;
type FilterId = typeof filters[number]["id"];
type Props = { project: Project; onDirtyChange: (dirty: boolean) => void; onNavigate?: (section: "brand" | "checks" | "reports") => void };

function dateInput(iso: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).replace(" ", "T");
}
function conditionText(condition: VerificationCondition) {
  if (condition.kind === "text_absent") return `删除旧说法：${condition.text}`;
  if (condition.kind === "text_present" || condition.kind === "readable_body") return `正文包含：${condition.text}`;
  if (condition.kind === "http_status") return `公开页面响应状态为 ${condition.equals}`;
  if (condition.kind === "robots_allows") return `允许抓取路径 ${condition.path}`;
  return condition.kind === "no_noindex" ? "页面没有 noindex 阻断" : condition.kind === "public_third_party_page_changed" ? "第三方公开页面已实际修改" : "补充资料并由企业确认";
}
function nextStep(task: ModificationTask, dirty: boolean) {
  if (dirty) return { title: "先保存修改后的草稿", description: "保存会建立新版本，原有批准失效，需要重新审核。" };
  if (task.basisStale) return { title: "先更新这项任务的依据", description: "品牌或分析依据已经变化，请回到检查结果重新核对后生成任务。" };
  if (task.state === "needs_material") return { title: "先补充企业资料", description: "资料确认前保留此任务，不把缺失的认证、报价或能力写成确定事实。" };
  if (task.state === "awaiting_approval") return { title: "核对草稿与条件，再批准", description: "批准的是当前文案和以下全部核验条件，发布由你在官网完成。" };
  if (task.state === "awaiting_publication" || task.state === "waiting_external") return { title: task.state === "waiting_external" ? "等待第三方处理后申报" : "在官网发布批准的内容", description: "实际发布后填写时间并申报，随后检查公开页面。申报本身不代表核验通过。" };
  if (task.state === "awaiting_verification") return { title: "检查当前发布的全部条件", description: "只有每项条件都有核验依据，才进入上线后复查。" };
  if (task.state === "verified_pending_review" || task.state === "synthetic_verified_pending_review") return { title: "进入复查报告观察变化", description: "保留这次发布与核验版本，按对应窗口查看样本覆盖和变化依据。" };
  if (task.state === "cancelled") return { title: "此任务已取消", description: task.cancelReason || "历史依据、批准与核验记录仍然保留。" };
  return { title: "查看已保存的复查依据", description: "原有发布和报告版本保留，可继续观察或建立下一轮任务。" };
}

export function TasksPanel({ project, onDirtyChange, onNavigate }: Props) {
  const base = `/api/projects/${project.id}/tasks`;
  const [collection, setCollection] = useState<TaskCollection | null>(null);
  const [selected, setSelected] = useState<ModificationTask | null>(null);
  const [pendingSelection, setPendingSelection] = useState<ModificationTask | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [snapshotId, setSnapshotId] = useState("");
  const [reason, setReason] = useState("");
  const [declaredAt, setDeclaredAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const discardNotice = useRef<HTMLDivElement>(null);
  const dirty = !!selected && text !== (selected.proposedText ?? "");
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (pendingSelection) discardNotice.current?.focus(); }, [pendingSelection]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await projectApi<TaskCollection>(base, { signal });
    if (!signal?.aborted) setCollection(data);
    return data;
  }, [base]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => load(controller.signal)).then((data) => {
      if (controller.signal.aborted) return;
      const first = data.tasks[0];
      if (first) { setSelected(first); setText(first.proposedText ?? ""); setDeclaredAt(dateInput(project.isSynthetic ? "2026-10-03T10:00:00.000Z" : new Date().toISOString())); }
    }).catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "任务读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load, project.isSynthetic]);

  function applyTask(task: ModificationTask) {
    setSelected(task); setText(task.proposedText ?? ""); setReason(""); setSnapshotId(""); setEditing(false); setPendingSelection(null);
    setDeclaredAt(dateInput(project.isSynthetic ? "2026-10-03T10:00:00.000Z" : new Date().toISOString())); setMessage(""); setError("");
  }
  async function act(url: string, body: unknown, success: string, method = "POST") {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await projectApi<{ task?: ModificationTask }>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const current = await load();
      const updated = result.task ?? current.tasks.find((task) => task.id === selected?.id) ?? current.tasks[0];
      if (updated) {
        setSelected(updated); setText(updated.proposedText ?? ""); setEditing(false);
        if (!selected) setDeclaredAt(dateInput(project.isSynthetic ? "2026-10-03T10:00:00.000Z" : new Date().toISOString()));
      }
      setMessage(success);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "操作未完成，当前编辑已保留。"); }
    finally { setBusy(false); }
  }
  function choose(task: ModificationTask) { if (task.id !== selected?.id) { if (dirty) setPendingSelection(task); else applyTask(task); } }
  function changeFilter(nextFilter: FilterId) {
    if (busy) return;
    setFilter(nextFilter);
    setPendingSelection(null);
    const allowed = filters.find((item) => item.id === nextFilter)!.states;
    const filtered = (collection?.tasks ?? []).filter((task) => !allowed || (allowed as readonly string[]).includes(task.state));
    if (selected && filtered.some((task) => task.id === selected.id)) return;
    if (dirty) return; // Preserve the current draft; the detail explicitly identifies its different scope.
    if (filtered[0]) applyTask(filtered[0]);
    else {
      setSelected(null); setText(""); setReason(""); setSnapshotId(""); setEditing(false); setPendingSelection(null);
    }
  }
  function action(action: string, success: string, extra: object = {}) { if (selected) void act(`${base}/${selected.id}/actions`, { action, expectedRevision: selected.revision, ...extra }, success); }
  function declare() {
    const parsed = new Date(`${declaredAt}:00+08:00`);
    if (!Number.isFinite(parsed.getTime())) { setError("请填写有效的北京时间。"); return; }
    action("declare", "发布申报已保存。下一步核对公开页面的全部条件。", { declaredPublishedAt: parsed.toISOString() });
  }
  const tasks = collection?.tasks ?? [];
  const activeFilter = filters.find((item) => item.id === filter)!;
  const matches = (task: ModificationTask, allowed: readonly string[] | null) => !allowed || allowed.includes(task.state);
  const visible = tasks.filter((task) => matches(task, activeFilter.states));
  const selectedOutsideFilter = !!selected && !visible.some((task) => task.id === selected.id);
  const release = selected?.releases.filter((item) => !item.superseded).at(-1);
  const verifications = selected?.verifications.filter((verification) => verification.releaseId === release?.id).slice().reverse() ?? [];
  const next = selected ? nextStep(selected, dirty) : null;
  const reviewable = selected && ["verified_pending_review", "synthetic_verified_pending_review", "reviewed", "synthetic_reviewed"].includes(selected.state);
  const canDeclare = selected && ["awaiting_publication", "waiting_external"].includes(selected.state) && selected.currentApprovalId;

  return <section className="workflow-area" aria-label="修改任务">
    <div className="workflow-heading"><div><span className="workflow-kicker">执行队列</span><h2>把诊断变成可核验的修改</h2><p>逐项审核、公开发布，再用页面证据确认。</p></div><Button variant={tasks.length ? "secondary" : "primary"} disabled={busy || loading || dirty} onClick={() => void act(base, { mode: project.isSynthetic ? "synthetic_template" : "analysis_diagnosis" }, "任务已根据当前依据生成，请从队列选择一项开始处理。")}><MixerHorizontalIcon />生成{project.isSynthetic ? "演练" : "诊断"}任务</Button></div>
    {project.isSynthetic && <div className="workflow-notice">合成演练项目 · 页面快照与核验时间仅用于演练，保留独立标识。</div>}
    {error && <div role="alert" className="workflow-feedback workflow-feedback-error">{error}</div>}{message && <div role="status" className="workflow-feedback">{message}</div>}
    {pendingSelection && <div className="workflow-discard" role="alert" tabIndex={-1} ref={discardNotice}><div><strong>当前草稿尚未保存</strong><p>保存后再切换，或明确放弃这次编辑。</p></div><div className="workflow-actions"><Button variant="secondary" onClick={() => setPendingSelection(null)}>继续编辑</Button><Button variant="danger" onClick={() => applyTask(pendingSelection)}>放弃编辑并切换</Button></div></div>}
    {loading ? <div className="workflow-loading" role="status" aria-label="正在读取任务"><div /><div /><div /></div> : tasks.length ? <div className="workflow-split">
      <aside className="workflow-list-pane" aria-label="任务队列"><div className="workflow-list-title"><h3>任务队列 <span>{tasks.length}</span></h3><span>按状态处理</span></div><div className="workflow-filters" aria-label="按任务状态筛选">{filters.map((item) => <button type="button" key={item.id} aria-pressed={item.id === filter} disabled={busy} onClick={() => changeFilter(item.id)}>{item.label}<span>{tasks.filter((task) => matches(task, item.states)).length}</span></button>)}</div>
        <div className="workflow-list">{visible.map((task) => <button type="button" className={`workflow-list-row ${selected?.id === task.id ? "is-selected" : ""}`} key={task.id} aria-pressed={selected?.id === task.id} onClick={() => choose(task)} disabled={busy}><span className="workflow-row-meta"><span>{task.fixtureTaskId || (task.priority === "high" ? "优先处理" : "修改任务")}</span><span>草稿 V{task.draftVersion}</span></span><strong>{task.title}</strong><span className="workflow-row-position">{task.position}</span><span className="workflow-row-footer"><span className={`workflow-state ${task.state === "needs_material" || task.basisStale ? "is-attention" : ""}`}>{task.basisStale ? "依据待更新" : states[task.state]}</span><ArrowRightIcon /></span></button>)}</div>{!visible.length && <p className="workflow-inline-empty">此状态下暂无任务，可切换其他状态查看。</p>}
      </aside>
      {selected && next ? <article className="workflow-detail" aria-label="当前任务详情">{selectedOutsideFilter && <div className="workflow-feedback" role="status">当前{dirty ? "编辑的草稿" : "任务"}不在“{activeFilter.label}”筛选内。{dirty ? "未保存的编辑已保留，可继续编辑，或从左侧选择任务后明确放弃。" : "此任务的状态已更新，可从左侧选择本筛选中的其他任务。"}</div>}<div className="workflow-detail-top"><div><span className="workflow-kicker">{selected.fixtureTaskId || "当前任务"} · 任务版本 V{selected.revision}</span><h3>{selected.title}</h3></div><span className="workflow-state">{states[selected.state]}</span></div>
        <dl className="workflow-target"><div><dt>目标页面</dt><dd>{selected.targetUrl}</dd></div><div><dt>修改位置</dt><dd>{selected.position}</dd></div></dl>
        <section className="workflow-next" aria-label="当前下一步"><span className="workflow-kicker">下一步</span><h4>{next.title}</h4><p>{next.description}</p>
          {dirty ? <Button disabled={busy} onClick={() => void act(`${base}/${selected.id}`, { expectedRevision: selected.revision, title: selected.title, targetUrl: selected.targetUrl, position: selected.position, proposedText: text || null, conditions: selected.conditions }, "草稿新版本已保存，需要重新审核后发布。", "PUT")}><CheckIcon />保存草稿新版本</Button>
            : selected.basisStale ? onNavigate && <Button onClick={() => onNavigate("checks")}>重新检查依据<ArrowRightIcon /></Button>
              : selected.state === "needs_material" ? onNavigate && <Button onClick={() => onNavigate("brand")}>去补充品牌资料<ArrowRightIcon /></Button>
                : selected.state === "awaiting_approval" ? <Button disabled={busy} onClick={() => action("approve", "当前草稿与核验条件已批准，请在目标页面完成发布。")}>批准当前草稿与条件<CheckIcon /></Button>
                  : reviewable ? onNavigate && <Button onClick={() => onNavigate("reports")}>查看复查报告<ArrowRightIcon /></Button> : null}
          {canDeclare && <div className="workflow-publish-controls"><label className="field"><span>{project.isSynthetic ? "演练声明发布时间" : "实际发布时间"}（北京时间）</span><input type="datetime-local" value={declaredAt} onChange={(event) => setDeclaredAt(event.target.value)} disabled={busy || dirty} /></label><Button disabled={busy || dirty || !declaredAt} onClick={declare}>申报已发布<ArrowRightIcon /></Button></div>}
          {selected.state === "awaiting_verification" && release && !selected.basisStale && <div className="workflow-publish-controls">{project.isSynthetic && <label className="field"><span>核验使用的合成页面快照</span><select value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)} disabled={busy}><option value="">选择当前页面的快照</option>{collection?.fixtureSnapshots.filter((snapshot) => snapshot.url === selected.targetUrl).map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.id} · {formatProjectDate(snapshot.observedAt)}</option>)}</select></label>}<Button disabled={busy || dirty || (project.isSynthetic && !snapshotId)} onClick={() => action("verify", "逐项核验已保存。请查看各条件的结果与依据。", { releaseId: release.id, source: project.isSynthetic ? "synthetic_fixture" : "live_public", ...(project.isSynthetic ? { snapshotId } : {}) })}>核验全部批准条件<ArrowRightIcon /></Button></div>}
        </section>
        <details className="workflow-disclosure"><summary><FileTextIcon /><span>诊断依据与企业事实</span><span className="workflow-summary-meta">资料 V{selected.basis.projectVersion} · {selected.evidence.length}项证据</span></summary><div className="workflow-disclosure-body">{selected.evidence.map((evidence, index) => <blockquote key={index}>{evidence.quote || evidence.id}</blockquote>)}<p>待验证假设：{selected.hypothesis}</p>{selected.factIds.length > 0 && <ul className="workflow-plain-list">{selected.factIds.map((id) => <li key={id}>{project.facts.find((fact) => fact.id === id)?.statement || `事实依据 ${id}`}</li>)}</ul>}{selected.missingFactIds.length > 0 && <p className="workflow-caution">这项任务仍有待确认资料，请先补充并确认依据。</p>}</div></details>
        <section className="workflow-section"><div className="workflow-section-heading"><h4>{selected.type === "access_repair" ? "技术修改要求" : "修改文案"}</h4>{selected.state !== "cancelled" && <Button variant="ghost" disabled={busy} onClick={() => setEditing((value) => !value)}>{editing ? "收起编辑" : "编辑草稿"}</Button>}</div>{editing ? <label className="field"><span>修改文案（保存后需重新审核）</span><textarea value={text} onChange={(event) => setText(event.target.value)} disabled={busy} rows={6} /></label> : <div className="workflow-copy">{text || (selected.type === "missing_facts" ? "确认所需资料后再形成修改文案。" : selected.type === "access_repair" ? "此任务按下方技术条件实施，无需发布文案。" : "当前任务尚无修改文案。")}</div>}</section>
        <section className="workflow-section"><div className="workflow-section-heading"><h4>批准与核验条件</h4><span>{selected.conditions.length}项 · 全部满足才通过</span></div><ol className="workflow-conditions">{selected.conditions.map((condition, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span><p>{conditionText(condition)}</p></li>)}</ol></section>
        {release && <section className="workflow-section"><div className="workflow-section-heading"><h4>发布 V{release.releaseVersion} 的核验记录</h4><ClockIcon /></div><p className="workflow-meta">申报于 {formatProjectDate(release.declaredPublishedAt)} · 首次全部通过：{release.syntheticAllConditionsPassedAt ? `演练 ${formatProjectDate(release.syntheticAllConditionsPassedAt)}` : release.firstAllConditionsPassedAt ? formatProjectDate(release.firstAllConditionsPassedAt) : "尚未通过"}</p>{verifications.length ? verifications.map((verification, index) => <details className="workflow-verification" key={verification.id} open={index === 0}><summary><span className={`workflow-state ${verification.allPassed ? "" : "is-attention"}`}>{verification.allPassed ? "全部条件通过" : "尚未全部通过"}</span><span>{verification.isSynthetic ? "合成演练" : "真实页面"} · {formatProjectDate(verification.executedAt)}</span></summary><ul className="workflow-check-results">{verification.checks.map((check) => <li key={check.index}><span className={check.result === "passed" ? "is-passed" : "is-unknown"}>{check.result === "passed" ? "通过" : check.result === "failed" ? "未通过" : "未知"}</span><p>{check.reason}</p></li>)}</ul></details>) : <p className="workflow-inline-empty">尚未核验。请先检查当前发布的全部批准条件。</p>}
          {selected.state !== "awaiting_verification" && selected.state !== "cancelled" && !selected.basisStale && <details className="workflow-disclosure"><summary><ReloadIcon /><span>重新检查当前发布</span></summary><div className="workflow-disclosure-body">{project.isSynthetic && <label className="field"><span>选择合成页面快照</span><select value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)}><option value="">请选择</option>{collection?.fixtureSnapshots.filter((snapshot) => snapshot.url === selected.targetUrl).map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.id} · {formatProjectDate(snapshot.observedAt)}</option>)}</select></label>}<Button variant="secondary" disabled={busy || dirty || (project.isSynthetic && !snapshotId)} onClick={() => action("verify", "新的核验记录已保存，历史核验仍保留。", { releaseId: release.id, source: project.isSynthetic ? "synthetic_fixture" : "live_public", ...(project.isSynthetic ? { snapshotId } : {}) })}>重新核验全部条件</Button></div></details>}
        </section>}
        <details className="workflow-disclosure"><summary><ClockIcon /><span>版本记录与取消任务</span><span className="workflow-summary-meta">{selected.approvals.length}次批准 · {selected.releases.length}次发布</span></summary><div className="workflow-disclosure-body"><ul className="workflow-plain-list">{selected.approvals.map((approval) => <li key={approval.id}>草稿 V{approval.draftVersion} · 批准于 {formatProjectDate(approval.approvedAt)}</li>)}{selected.releases.map((item) => <li key={item.id}>发布 V{item.releaseVersion} · {formatProjectDate(item.declaredPublishedAt)}{item.superseded ? " · 已被后续版本替代" : " · 当前发布"}</li>)}</ul>{selected.state !== "cancelled" && <div className="workflow-cancel"><label className="field"><span>取消原因（至少8个字）</span><input value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label><Button variant="danger" disabled={busy || dirty || reason.trim().length < 8} onClick={() => action("cancel", "任务已取消，历史依据与核验记录仍然保留。", { reason })}>取消任务并保留历史</Button></div>}</div></details>
      </article> : <div className="workflow-empty" aria-label="当前任务详情"><FileTextIcon /><h3>当前筛选下没有任务</h3><p>切换其他状态，或返回全部任务继续处理。</p><Button variant="secondary" onClick={() => changeFilter("all")}>查看全部任务<ArrowRightIcon /></Button></div>}
    </div> : <div className="workflow-empty"><FileTextIcon /><h3>从一项有依据的修改开始</h3><p>先在检查结果中保存回答并完成分析，再生成对应的修改任务。</p>{onNavigate && <Button variant="secondary" onClick={() => onNavigate("checks")}>去检查结果<ArrowRightIcon /></Button>}</div>}
  </section>;
}

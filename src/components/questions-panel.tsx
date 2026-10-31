"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, ClockIcon, DownloadIcon, PlusIcon, ReloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { ApiFailure, formatProjectDate, projectApi } from "@/components/project-api";
import {
  questionGroups, questionGroupLabels, questionSources, questionSourceLabels,
  type QuestionInput, type QuestionSet, type QuestionSetVersion,
} from "@/lib/question-contracts";

interface Props {
  projectId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
type EditableQuestion = QuestionInput & { clientKey: string };
const controlClass = "w-full rounded-md border border-[#dfe5dc] bg-[#fdfefb] px-3 py-2 text-sm text-[#344139] disabled:bg-[#f3f5f0] disabled:text-[#788271]";

function newQuestion(): EditableQuestion {
  return { clientKey: crypto.randomUUID(), text: "", group: "industry_discovery", sourceType: "manual", sourceRef: "", sourceModel: null, priority: "normal", isFocus: false };
}

function toInput(questions: EditableQuestion[]): QuestionInput[] {
  return questions.map(({ id, text, group, sourceType, sourceRef, sourceModel, priority, isFocus }) => ({
    ...(id ? { id } : {}), text, group, sourceType, sourceRef,
    sourceModel: sourceType === "model_suggestion" ? sourceModel?.trim() || null : null,
    priority, isFocus,
  }));
}

function pendingReasons(questions: EditableQuestion[]): string[] {
  const reasons: string[] = [];
  const seen = new Map<string, number>();
  if (!questions.length) reasons.push("请至少填写一个真实买家问题。");
  questions.forEach((question, index) => {
    if (!question.text.trim()) reasons.push(`第 ${index + 1} 题缺少问题文本。`);
    if (!question.sourceRef.trim()) reasons.push(`第 ${index + 1} 题缺少来源说明。`);
    const normalized = question.text.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase();
    if (normalized && seen.has(normalized)) reasons.push(`第 ${index + 1} 题与第 ${seen.get(normalized)! + 1} 题重复。`);
    else if (normalized) seen.set(normalized, index);
  });
  return reasons;
}

export function QuestionsPanel(props: Props) {
  // Switching projects starts an independent editor and aborts the old read.
  return <QuestionsEditor key={props.projectId} {...props} />;
}

function QuestionsEditor({ projectId, onDirtyChange }: Props) {
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
  const [questions, setQuestions] = useState<EditableQuestion[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [versions, setVersions] = useState<QuestionSetVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<{ revision: number; count: number } | null>(null);
  const confirmationRegion = useRef<HTMLDivElement>(null);
  const confirmationButton = useRef<HTMLButtonElement>(null);
  const baseUrl = `/api/projects/${encodeURIComponent(projectId)}/questions`;
  const dirty = JSON.stringify(toInput(questions)) !== baseline;
  const reasons = pendingReasons(questions);
  const selected = versions.find((version) => version.version === selectedVersion);

  const applyQuestionSet = useCallback((next: QuestionSet) => {
    const editable = next.questions.map((question) => ({ ...question, clientKey: question.id }));
    setQuestionSet(next);
    setQuestions(editable);
    setBaseline(JSON.stringify(toInput(editable)));
    setConflict(false);
    setConfirmation(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    projectApi<{ questionSet: QuestionSet; versions: QuestionSetVersion[] }>(baseUrl, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        applyQuestionSet(result.questionSet);
        setVersions(result.versions);
        setSelectedVersion(result.versions[0]?.version ?? null);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "问题集读取失败。");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applyQuestionSet, baseUrl, attempt]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => { if (confirmation) confirmationRegion.current?.focus(); }, [confirmation]);
  useEffect(() => {
    if (!dirty) return;
    function warnBeforeExit(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warnBeforeExit);
    return () => window.removeEventListener("beforeunload", warnBeforeExit);
  }, [dirty]);

  function editQuestion(index: number, patch: Partial<EditableQuestion>) {
    setQuestions((items) => items.map((question, position) => position === index ? { ...question, ...patch } : question));
    setMessage("");
    setConfirmation(null);
  }

  function reload() {
    if (dirty && !window.confirm("当前问题有未保存的修改，确定放弃并读取最新版本吗？")) return;
    setLoading(true); setError(""); setMessage(""); setConfirmation(null); setAttempt((value) => value + 1);
  }

  async function saveDraft() {
    if (!questionSet || busy || !dirty) return;
    setBusy(true); setError(""); setMessage(""); setConfirmation(null);
    try {
      const result = await projectApi<{ questionSet: QuestionSet }>(baseUrl, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: toInput(questions), expectedVersion: questionSet.revision }),
      });
      applyQuestionSet(result.questionSet);
      setMessage("草稿已保存，明确确认后才可用于正式采样。此前已确认版本保持不变。");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "草稿保存失败，编辑内容已保留。");
      setConflict(failure instanceof ApiFailure && failure.status === 409);
    } finally { setBusy(false); }
  }

  function prepareConfirmation() {
    if (!questionSet || dirty || busy || conflict || reasons.length || questions.length > 20 || questionSet.status !== "draft") return;
    setConfirmation({ revision: questionSet.revision, count: questions.length });
    setError(""); setMessage("");
  }

  function cancelConfirmation() {
    setConfirmation(null);
    requestAnimationFrame(() => confirmationButton.current?.focus());
  }

  async function confirm() {
    if (!questionSet || !confirmation || confirmation.revision !== questionSet.revision
      || confirmation.count !== questions.length || dirty || busy || conflict || reasons.length
      || questions.length > 20 || questionSet.status !== "draft") return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await projectApi<{ questionSet: QuestionSet; version: QuestionSetVersion }>(`${baseUrl}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: confirmation.revision }),
      });
      applyQuestionSet(result.questionSet);
      setVersions((items) => [result.version, ...items]);
      setSelectedVersion(result.version.version);
      setMessage(`问题版本 V${result.version.version} 已确认，提问文本和配置已冻结。`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "问题确认失败。");
      setConflict(failure instanceof ApiFailure && failure.status === 409);
      setConfirmation(null);
    } finally { setBusy(false); }
  }

  async function downloadSamplingInputs() {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      const result = await projectApi<{ questionVersion: number; inputs: unknown[] }>(`${baseUrl}/versions/${selected.version}/sampling-inputs`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `buyer-questions-v${selected.version}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "提问导出失败。"); }
    finally { setBusy(false); }
  }

  return (
    <section id="buyer-questions" className="form-panel mt-7" aria-labelledby="questions-title">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><span className="eyebrow">BUYER QUESTIONS</span><h2 id="questions-title" className="mt-2 text-xl font-semibold text-[#304338]">真实买家问题</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#667361]">优先使用销售咨询、客户 FAQ 和已有搜索词。建议先确认 10 题，最多 20 题；只发送你确认的提问文本，不额外注入品牌资料。</p></div>
        {!loading && questionSet && <span className={`status-pill ${!dirty && questionSet.status === "confirmed" ? "status-confirmed" : "status-pending"}`}>{dirty ? "有未保存修改" : questionSet.status === "confirmed" ? `已确认 V${questionSet.latestConfirmedVersion}` : "待确认草稿"}</span>}
      </header>

      {loading ? <p className="mt-7 flex items-center gap-2 text-sm text-[#667361]" role="status"><span className="spinner" />正在读取问题与历史版本…</p> : !questionSet ? <div className="mt-6"><p role="alert" className="text-sm text-[#a65f45]">{error || "问题集尚未就绪。"}</p><Button type="button" className="mt-3" onClick={reload}><ReloadIcon />重新读取</Button></div> : <>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-[#e6eade] py-4">
          <p className="text-sm text-[#667361]">当前 <strong className="text-[#304338]">{questions.length} / 20</strong> 题 · 重点问题 {questions.filter((question) => question.isFocus).length} 题{questionSet.latestConfirmedVersion && <span> · 最近确认 V{questionSet.latestConfirmedVersion}</span>}</p>
          <div className="flex flex-wrap gap-2">
            {!questions.length && <Button type="button" variant="secondary" size="small" disabled={busy} onClick={() => { setQuestions(Array.from({ length: 10 }, newQuestion)); setMessage(""); setConfirmation(null); }}>准备 10 个空白问题</Button>}
            <Button type="button" variant="secondary" size="small" disabled={busy || questions.length >= 20} onClick={() => { setQuestions((items) => [...items, newQuestion()]); setMessage(""); setConfirmation(null); }}><PlusIcon />添加问题</Button>
          </div>
        </div>

        {message && <div className="feedback-banner feedback-success mt-4" role="status"><CheckIcon /><span>{message}</span></div>}
        {error && <div className="feedback-banner feedback-error mt-4" role="alert"><div><p>{error}</p><p>当前编辑内容已保留。</p>{conflict && <Button type="button" variant="secondary" size="small" onClick={reload}>读取最新问题集</Button>}</div></div>}

        {!questions.length ? <div className="py-9 text-center"><p className="font-medium text-[#405144]">先记录客户会怎样提问</p><p className="mt-2 text-sm text-[#667361]">这里不会自动填入虚构问题。可添加真实问题，也可先准备十个空白位置。</p></div> : <div className="mt-5 space-y-4">{questions.map((question, index) => (
          <article key={question.clientKey} className="rounded-lg border border-[#e2e8dc] bg-[#fafcf7] p-4 sm:p-5" aria-label={`第 ${index + 1} 个买家问题`}>
            <div className="mb-4 flex items-center justify-between gap-3"><strong className="text-sm text-[#405144]">问题 {String(index + 1).padStart(2, "0")}</strong><Button type="button" variant="ghost" size="icon" aria-label={`移除第 ${index + 1} 题`} disabled={busy} onClick={() => { setQuestions((items) => items.filter((_, position) => position !== index)); setMessage(""); setConfirmation(null); }}><TrashIcon /></Button></div>
            <label className="field"><span>问题文本</span><textarea rows={2} maxLength={2000} disabled={busy} value={question.text} onChange={(event) => editQuestion(index, { text: event.target.value })} placeholder="填写客户实际会问的问题" /></label>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="field"><span>问题分组</span><select className={controlClass} value={question.group} disabled={busy} onChange={(event) => editQuestion(index, { group: event.target.value as QuestionInput["group"] })}>{questionGroups.map((group) => <option key={group} value={group}>{questionGroupLabels[group]}</option>)}</select></label>
              <label className="field"><span>业务优先级</span><select className={controlClass} value={question.priority} disabled={busy} onChange={(event) => editQuestion(index, { priority: event.target.value as QuestionInput["priority"] })}><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select></label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-[#405144]"><input type="checkbox" checked={question.isFocus} disabled={busy} onChange={(event) => editQuestion(index, { isFocus: event.target.checked })} />列为重点问题</label>
              <label className="field"><span>问题来源</span><select className={controlClass} value={question.sourceType} disabled={busy} onChange={(event) => editQuestion(index, { sourceType: event.target.value as QuestionInput["sourceType"], sourceModel: null })}>{questionSources.map((source) => <option key={source} value={source}>{questionSourceLabels[source]}</option>)}</select></label>
              <label className="field sm:col-span-2"><span>来源说明或出处</span><input value={question.sourceRef} maxLength={2000} disabled={busy} onChange={(event) => editQuestion(index, { sourceRef: event.target.value })} placeholder="例如：销售访谈日期、客户 FAQ 章节或已有搜索词出处" /></label>
              {question.sourceType === "model_suggestion" && <label className="field sm:col-span-2"><span>来源模型（可留空）</span><input value={question.sourceModel ?? ""} maxLength={200} disabled={busy} onChange={(event) => editQuestion(index, { sourceModel: event.target.value || null })} placeholder="未知时留空，不会当作已验证模型来源" /><small>这里只记录你提供的补充建议，本步骤不调用模型，也不会自动开始采样。</small></label>}
            </div>
          </article>
        ))}</div>}

        {reasons.length > 0 && questions.length > 0 && <details className="mt-5 rounded-md border border-[#ecdfc6] bg-[#fffaf0] px-4 py-3 text-sm text-[#785e35]"><summary className="cursor-pointer">确认前还需核对 {reasons.length} 项，可先保存草稿</summary><ul className="mt-2 list-inside list-disc space-y-1">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#e2e8dc] pt-5">
          <div className="text-xs leading-5 text-[#667361]"><p>{dirty ? "修改尚未保存。" : questionSet.status === "confirmed" ? "当前确认版本已冻结，编辑后保存为新草稿。" : "草稿尚未确认，不能用于正式采样。"}</p>{questionSet.updatedAt && <p>保存于 {formatProjectDate(questionSet.updatedAt)} · 草稿修订 {questionSet.revision}</p>}</div>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={busy || !dirty || conflict} onClick={() => void saveDraft()}>保存草稿</Button><Button ref={confirmationButton} type="button" disabled={busy || dirty || conflict || questionSet.status !== "draft" || reasons.length > 0 || confirmation !== null} aria-expanded={confirmation !== null} aria-controls="questions-confirmation" onClick={prepareConfirmation}><CheckIcon />确认并冻结版本</Button></div>
        </div>

        {confirmation && <div id="questions-confirmation" ref={confirmationRegion} role="region" tabIndex={-1} aria-labelledby="questions-confirmation-title" aria-describedby="questions-confirmation-description" className="mt-5 rounded-lg border border-[#ccdcbc] bg-[#f4f8ed] p-5">
          <h3 id="questions-confirmation-title" className="font-semibold text-[#405144]">再次核对：冻结这 {confirmation.count} 个问题</h3>
          <p id="questions-confirmation-description" className="mt-2 text-sm leading-6 text-[#667361]">确认后将创建已确认问题版本 V{(questionSet.latestConfirmedVersion ?? 0) + 1}，保留当前提问文本、来源、分组、优先级和重点标记。该版本只读保存，后续编辑另存草稿。</p>
          <div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={cancelConfirmation}>取消，返回核对</Button><Button type="button" disabled={busy || dirty || conflict || reasons.length > 0 || questions.length > 20 || questionSet.status !== "draft" || confirmation.revision !== questionSet.revision || confirmation.count !== questions.length} onClick={() => void confirm()}>{busy ? <span className="spinner" /> : <CheckIcon />}{busy ? "正在冻结…" : `确认冻结这${confirmation.count}题`}</Button></div>
        </div>}

        <details className="mt-7 border-t border-[#e2e8dc] pt-5">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#405144]"><ClockIcon />已确认问题版本 <span className="text-xs font-normal text-[#667361]">{versions.length} 版 · 只读保留</span></summary>
          {!versions.length ? <p className="mt-4 text-sm text-[#667361]">尚无已确认版本。保存草稿后，请核对问题与出处并明确确认。</p> : <div className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-4"><label className="field min-w-48"><span>选择历史问题版本</span><select className={controlClass} value={selectedVersion ?? ""} onChange={(event) => setSelectedVersion(Number(event.target.value))}>{versions.map((version) => <option key={version.version} value={version.version}>V{version.version} · {formatProjectDate(version.confirmedAt)}</option>)}</select></label><Button type="button" variant="secondary" size="small" disabled={!selected || busy} onClick={() => void downloadSamplingInputs()}><DownloadIcon />导出已确认提问</Button></div>
            {selected && <div className="mt-4 rounded-lg border border-[#e2e8dc] p-4"><p className="text-xs text-[#667361]">确认者：{selected.confirmedBy} · V{selected.version} · {selected.questions.length} 题。这里只展示冻结的问题，后续草稿不会改写它。</p><ol className="mt-4 space-y-4">{selected.questions.map((question, index) => <li key={question.id} className="border-t border-[#eef0e8] pt-3 text-sm"><p className="font-medium text-[#405144]">{index + 1}. {question.text}</p><p className="mt-1 text-xs text-[#667361]">{questionGroupLabels[question.group]} · {question.priority === "high" ? "高优先级" : question.priority === "low" ? "低优先级" : "普通优先级"}{question.isFocus ? " · 重点问题" : ""} · {questionSourceLabels[question.sourceType]}</p><p className="mt-1 break-words text-xs text-[#667361]">出处：{question.sourceRef}{question.sourceType === "model_suggestion" ? ` · 模型：${question.sourceModel || "未知"}` : ""}</p></li>)}</ol><p className="mt-4 text-xs leading-5 text-[#667361]">导出内容来自该已确认版本，仅包含提问与必要分组配置，不附加品牌资料。</p></div>}
          </div>}
        </details>
      </>}
    </section>
  );
}

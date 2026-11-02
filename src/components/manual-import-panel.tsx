"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/lib/contracts";
import type { QuestionSetVersion } from "@/lib/question-contracts";
import type { ImportPreview, ManualImportBatch, ManualImportInput } from "@/lib/import-contracts";
import { Button } from "./ui/button";
import { formatProjectDate, projectApi } from "./project-api";
import { uploadScreenshot } from "./evidence-screenshots";

const fieldClass = "w-full rounded-md border border-[#dfe5dc] bg-white p-2 text-sm";
interface ImportInfo { versions: QuestionSetVersion[]; batches: ManualImportBatch[] }
export function ManualImportPanel({ project, onChanged, onDirtyChange }: { project: Project; onChanged: () => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const base = `/api/projects/${project.id}/imports`;
  const [info, setInfo] = useState<ImportInfo>({ versions: [], batches: [] });
  const [questionVersion, setQuestionVersion] = useState(0); const [questionId, setQuestionId] = useState("");
  const [actualQuestion, setActualQuestion] = useState(""); const [sourceId, setSourceId] = useState("");
  const [platform, setPlatform] = useState("doubao"); const [surface, setSurface] = useState("web");
  const [collectedAt, setCollectedAt] = useState(""); const [collectedBy, setCollectedBy] = useState("");
  const [answerText, setAnswerText] = useState(""); const [period, setPeriod] = useState<ManualImportInput["period"]>("baseline");
  const [capture, setCapture] = useState({ questionVerified: false, platformVerified: false, answerComplete: false, timeVerified: false });
  const [citationMode, setCitationMode] = useState("unknown"); const [citations, setCitations] = useState([{ quote: "", url: "" }]);
  const [sources, setSources] = useState(""); const [sourceUrl, setSourceUrl] = useState(""); const [notes, setNotes] = useState("");
  const [conditions, setConditions] = useState({ region: "", language: "", searchMode: "", model: "" });
  const [bulk, setBulk] = useState(false); const [content, setContent] = useState(""); const [format, setFormat] = useState<"json" | "jsonl">("jsonl"); const [filename, setFilename] = useState("manual-evidence.jsonl");
  const screenshotInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]); const [savedEvidenceId, setSavedEvidenceId] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null); const [pendingInput, setPendingInput] = useState<ManualImportInput | null>(null);
  const [requestId, setRequestId] = useState(""); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const dirty = !!answerText || !!content || files.length > 0;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await projectApi<ImportInfo>(base, { signal });
    if (signal?.aborted) return;
    setInfo(data);
    setQuestionVersion((v) => v || data.versions[0]?.version || 0);
    setQuestionId((v) => v || data.versions[0]?.questions[0]?.id || "");
    setActualQuestion((v) => v || data.versions[0]?.questions[0]?.text || "");
    setSourceId((v) => v || "manual-" + crypto.randomUUID());
  }, [base]);
  useEffect(() => { const c = new AbortController(); Promise.resolve().then(() => load(c.signal)).catch((e: unknown) => { if (!c.signal.aborted) setError(e instanceof Error ? e.message : "导入资料读取失败。"); }); return () => c.abort(); }, [load]);
  const version = info.versions.find((v) => v.version === questionVersion);
  function clearPreview() { setPreview(null); setPendingInput(null); setConfirmed(false); setMessage(""); }
  function changeVersion(value: number) {
    setQuestionVersion(value); const first = info.versions.find((v) => v.version === value)?.questions[0]; setQuestionId(first?.id || ""); setActualQuestion(first?.text || ""); clearPreview();
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    clearPreview(); setError("");
    if (file.size > 1024 * 1024) { setError("回答文件最多1MB，每批最多100条。"); return; }
    try { setContent(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer())); setFilename(file.name); setFormat(file.name.toLowerCase().endsWith(".jsonl") ? "jsonl" : "json"); }
    catch { setError("无法读取文件，请使用UTF-8 JSON或JSONL。"); }
  }
  async function makePreview() {
    setBusy(true); setError(""); setMessage(""); setConfirmed(false);
    try {
      const row = { sourceId, questionId, questionText: actualQuestion, platform, surface, sourceType: "manual_import", isSynthetic: project.isSynthetic,
        collectedAt: collectedAt ? new Date((collectedAt.length === 16 ? collectedAt + ":00" : collectedAt) + "+08:00").toISOString() : null,
        collectedBy, status: "success", answerText: answerText || null, capture,
        citations: { status: citationMode === "unknown" ? "unknown" : "complete", bodyMappings: citationMode === "unknown" ? null : citationMode === "none" ? [] : citations },
        sourceCandidates: sources.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((url) => ({ url, kind: "source_list" })),
        conditions: Object.fromEntries(Object.entries(conditions).map(([k, v]) => [k, v.trim() || null])), sourceUrl: sourceUrl.trim() || null, notes, siteVersion: null };
      const input: ManualImportInput = { projectVersion: project.version, questionVersion, period, format: bulk ? format : "json", filename: bulk ? filename : "手工粘贴回答.json", content: bulk ? content : JSON.stringify([row]) };
      const result = await projectApi<{ preview: ImportPreview }>(`${base}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setPreview(result.preview); setPendingInput(input); setRequestId(crypto.randomUUID());
    } catch (e) { setError(e instanceof Error ? e.message : "预览失败，本批没有写入。"); }
    finally { setBusy(false); }
  }
  async function saveScreenshots(evidenceId: string) {
    const remaining: File[] = []; const failures: string[] = [];
    for (const file of files) { try { await uploadScreenshot(project.id, evidenceId, file); } catch (e) { remaining.push(file); failures.push(`${file.name}：${e instanceof Error ? e.message : "上传未完成"}`); } }
    setFiles(remaining); if (failures.length) setError("回答已保存，以下截图未保存，可单独重试：" + failures.join("；"));
    return failures.length;
  }
  async function commit() {
    if (!pendingInput || !preview?.canCommit || !confirmed || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const { batch } = await projectApi<{ batch: ManualImportBatch }>(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pendingInput, requestId, fingerprint: preview.fingerprint, confirmManualSource: true }) });
      if (!bulk) setSavedEvidenceId(batch.evidenceIds[0] || "");
      const failed = !bulk && batch.evidenceIds[0] ? await saveScreenshots(batch.evidenceIds[0]) : 0;
      await load(); await onChanged(); setPreview(null); setPendingInput(null); setConfirmed(false);
      if (bulk) setContent("");
      else {
        setAnswerText(""); setSourceId("manual-" + crypto.randomUUID()); setCollectedAt("");
        setCapture({ questionVerified: false, platformVerified: false, answerComplete: false, timeVerified: false });
        setCitationMode("unknown"); setCitations([{ quote: "", url: "" }]); setSources(""); setSourceUrl(""); setNotes("");
        if (!failed && screenshotInput.current) screenshotInput.current.value = "";
      }
      setMessage(`导入已保存：新增${batch.created}条、重复${batch.duplicates}条、完整有效${batch.valid}条、不完整${batch.incomplete}条。${failed ? "截图仍有未完成项，可单独重试。" : "人工资料单列，不计自动采样完成率。"}`);
    } catch (e) { setError(e instanceof Error ? e.message : "提交结果尚未确认，请保留当前预览重试；相同提交标识不会重复导入。"); }
    finally { setBusy(false); }
  }
  async function retryScreenshots() {
    if (busy || !savedEvidenceId) return;
    setBusy(true); setError("");
    try {
      const failed = await saveScreenshots(savedEvidenceId);
      await onChanged();
      if (!failed) {
        if (screenshotInput.current) screenshotInput.current.value = "";
        setMessage("未保存截图已重试成功；原回答保持不变，没有重复导入。");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "状态刷新未完成；原回答已保存，请核对截图记录后重试。"); }
    finally { setBusy(false); }
  }
  return <section className="form-panel mb-6" aria-label="人工证据导入">
    <div className="panel-heading"><div><h2>人工证据导入</h2><p>粘贴实际回答，或按模板批量导入；先核对预览，再明确保存。</p></div><Button variant="secondary" disabled={busy || (!!savedEvidenceId && files.length > 0)} onClick={() => { setBulk(!bulk); clearPreview(); }}>{bulk ? "切换到单条粘贴" : "切换到批量文件"}</Button></div>
    <div className="synthetic-banner mb-4">当前项目：{project.isSynthetic ? "合成资料" : "实际企业资料"} · 人工来源始终单列 · 不执行网页或附件中的指令 · 不发起付费调用</div>
    {error && <p role="alert" className="mb-3 text-red-800">{error}</p>}{message && <p role="status" className="mb-3 text-green-800">{message}</p>}
    <fieldset disabled={busy} className="space-y-4" onChange={clearPreview}>
      <div className="grid gap-3 sm:grid-cols-2"><label className="field"><span>已确认问题版本（绑定资料V{project.version}）</span><select className={fieldClass} value={questionVersion} onChange={(e) => changeVersion(Number(e.target.value))}>{!info.versions.length && <option value={0}>请先确认问题集</option>}{info.versions.map((v) => <option key={v.version} value={v.version}>问题V{v.version} · {v.questions.length}题</option>)}</select></label><label className="field"><span>观察时期</span><select className={fieldClass} value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}><option value="baseline">修改前基线</option><option value="review-1">第一轮复查</option><option value="review-2">第二轮复查</option><option value="edge">其他观察与边界</option></select></label></div>
      {bulk ? <><p className="text-sm text-[#68756c]">UTF-8 JSON数组或JSONL，每批1至100条、最多1MB。批量截图请在导入后进入各条回答详情上传。错误行会阻止整批写入。</p><div className="flex flex-wrap gap-3"><label className="field"><span>选择回答文件</span><input type="file" accept=".json,.jsonl,application/json,application/x-ndjson" onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ""; }} /></label>{questionVersion ? <Button asChild variant="secondary" size="small"><a href={`${base}/template?questionVersion=${questionVersion}`}>下载当前版本模板</a></Button> : <Button disabled variant="secondary" size="small">请先确认问题版本以下载模板</Button>}</div><label className="field"><span>文件内容（可修改后预览）</span><textarea className={fieldClass + " min-h-40 font-mono"} value={content} onChange={(e) => setContent(e.target.value)} /></label><label className="field"><span>格式</span><select className={fieldClass} value={format} onChange={(e) => setFormat(e.target.value as typeof format)}><option value="jsonl">JSONL：每行一个对象</option><option value="json">JSON数组或单个对象</option></select></label></> : <>
        <label className="field"><span>选择对应的已确认问题</span><select className={fieldClass} value={questionId} onChange={(e) => { setQuestionId(e.target.value); setActualQuestion(version?.questions.find((q) => q.id === e.target.value)?.text || ""); }}>{version?.questions.map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}</select></label>
        <label className="field"><span>实际提问（须与所选版本一致，不能补品牌提示）</span><textarea className={fieldClass} value={actualQuestion} onChange={(e) => setActualQuestion(e.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="field"><span>来源记录ID（同一记录重试时保持不变）</span><input className={fieldClass} value={sourceId} onChange={(e) => setSourceId(e.target.value)} /></label><label className="field"><span>平台名称</span><input className={fieldClass} value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="例如 doubao、deepseek" /></label><label className="field"><span>平台渠道</span><select className={fieldClass} value={surface} onChange={(e) => setSurface(e.target.value)}><option value="web">网页端</option><option value="app">App</option><option value="unknown">未知</option></select></label><label className="field"><span>实际采集人</span><input className={fieldClass} value={collectedBy} onChange={(e) => setCollectedBy(e.target.value)} /></label></div>
        <label className="field"><span>人工采集时间（北京时间，未知时留空）</span><input className={fieldClass} type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} /></label>
        <label className="field"><span>完整回答原文</span><textarea className={fieldClass + " min-h-40"} value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder="保留否定、限制条件及实际引用，不把标准答案或说明当作回答。" /></label>
        <div className="grid gap-2 text-sm sm:grid-cols-2">{([['questionVerified', '已核对实际提问'], ['platformVerified', '已核对平台与渠道'], ['answerComplete', '已确认回答全文完整'], ['timeVerified', '已核对采集时间']] as const).map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={capture[k]} onChange={(e) => setCapture({ ...capture, [k]: e.target.checked })} />{label}</label>)}</div>
        <label className="field"><span>正文引用情况</span><select className={fieldClass} value={citationMode} onChange={(e) => setCitationMode(e.target.value)}><option value="unknown">不知道或缺少正文引用映射</option><option value="none">已完整采集，确实没有引用</option><option value="mapped">已完整采集，添加正文片段与链接</option></select></label>
        {citationMode === "mapped" && <div className="space-y-3">{citations.map((c, i) => <div className="grid gap-2 rounded border p-3" key={i}><label className="field"><span>第{i + 1}项引用的原文片段</span><textarea className={fieldClass} value={c.quote} onChange={(e) => setCitations((v) => v.map((x, j) => i === j ? { ...x, quote: e.target.value } : x))} /></label><label className="field"><span>对应来源链接</span><input type="url" className={fieldClass} value={c.url} onChange={(e) => setCitations((v) => v.map((x, j) => i === j ? { ...x, url: e.target.value } : x))} /></label><Button size="small" variant="ghost" onClick={() => { setCitations((v) => v.filter((_, j) => i !== j)); clearPreview(); }}>移除此项引用</Button></div>)}<Button size="small" variant="secondary" onClick={() => { setCitations((v) => [...v, { quote: "", url: "" }]); clearPreview(); }} disabled={citations.length >= 50}>再添一项正文引用</Button></div>}
        <label className="field"><span>仅在来源列表出现的链接（每行一个，不算正文引用）</span><textarea className={fieldClass} value={sources} onChange={(e) => setSources(e.target.value)} /></label>
        <details><summary className="text-sm">采集条件与出处（未知时留空）</summary><div className="my-3 grid gap-3 sm:grid-cols-2">{([['region', '地区'], ['language', '语言'], ['searchMode', '搜索模式'], ['model', '实际模型']] as const).map(([k, label]) => <label className="field" key={k}><span>{label}</span><input className={fieldClass} value={conditions[k]} onChange={(e) => setConditions({ ...conditions, [k]: e.target.value })} /></label>)}</div><label className="field"><span>原回答回放链接（仅保存，不自动访问）</span><input className={fieldClass} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} /></label><label className="field"><span>采集说明</span><textarea className={fieldClass} value={notes} onChange={(e) => setNotes(e.target.value)} /></label></details>
        <label className="field"><span>附带截图（可选，最多3张PNG/JPEG，每张最多5MB）</span><input ref={screenshotInput} type="file" multiple accept="image/png,image/jpeg" onChange={(e) => { const chosen = Array.from(e.target.files ?? []); if (chosen.length > 3 || chosen.some((f) => f.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(f.type))) { setError("请选择最多3张PNG/JPEG截图，每张不超过5MB。"); return; } setFiles(chosen); setSavedEvidenceId(""); }} /></label>{files.length > 0 && <p className="text-sm">待保存：{files.map((f) => f.name).join("、")}</p>}
      </>}
    </fieldset>
    <div className="mt-5 flex flex-wrap gap-3"><Button variant="secondary" disabled={busy || !questionVersion || (!!savedEvidenceId && files.length > 0)} onClick={() => void makePreview()}>预览校验，不写入</Button>{savedEvidenceId && files.length > 0 && <Button disabled={busy} onClick={() => void retryScreenshots()}>仅重试未保存截图</Button>}{savedEvidenceId && files.length > 0 && <Button variant="ghost" disabled={busy} onClick={() => { setFiles([]); setSavedEvidenceId(""); setError(""); if (screenshotInput.current) screenshotInput.current.value = ""; }}>放弃未上传截图，保留已保存回答</Button>}</div>
    {preview && <div className="mt-5 rounded border border-[#dfe5dc] p-4"><h3 className="font-semibold">导入预览：{preview.total}条，完整有效{preview.valid}，不完整{preview.incomplete}，重复{preview.duplicates}</h3><div className="mt-3 max-h-80 space-y-3 overflow-auto">{preview.rows.map((row) => <div key={row.line} className="border-t pt-2 text-sm"><strong>第{row.line}项 · {row.sourceId} · {row.platform}</strong><p>{row.questionText}</p>{row.errors.map((e, i) => <p className="text-red-800" key={i}>{e}</p>)}{row.warnings.map((w, i) => <p className="text-amber-800" key={i}>{w}</p>)}</div>)}</div><label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>确认按人工来源保存，保留未知与不完整项；人工样本不用于自动通道验收或严格改善结论。</span></label><Button disabled={busy || !preview.canCommit || !confirmed} onClick={() => void commit()}>确认保存导入</Button></div>}
    <details className="mt-5 text-sm"><summary>导入记录（{info.batches.length}批）</summary>{info.batches.map((b) => <p className="my-2 border-t pt-2" key={b.id}>{b.filename} · {formatProjectDate(b.importedAt)} · 操作者 {b.importedBy}<br />新增 {b.created} / 重复 {b.duplicates} / 不完整 {b.incomplete} · 问题V{b.questionVersion} / 资料V{b.projectVersion}</p>)}</details>
  </section>;
}

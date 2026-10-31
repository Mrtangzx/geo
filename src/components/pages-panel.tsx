"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, ClockIcon, Cross2Icon, ExternalLinkIcon, PlusIcon, ReloadIcon, TrashIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { ApiFailure, formatProjectDate, projectApi } from "@/components/project-api";
import type { PageCollection, PageCollectionResponse, PageSnapshot, PageSnapshotSummary, SelectedPage } from "@/lib/page-contracts";

interface Props { projectId: string; onDirtyChange?: (dirty: boolean) => void }
type EditablePage = { id?: string; clientKey: string; url: string; label: string };
const controlClass = "w-full rounded-md border border-[#dfe5dc] bg-[#fdfefb] px-3 py-2 text-sm text-[#344139]";
const statusLabels: Record<PageSnapshot["status"], string> = { running: "检查中", success: "已取得响应", http_error: "HTTP 异常", blocked: "无法检查", failed: "检查失败" };
const readabilityLabels: Record<PageSnapshot["bodyReadable"], string> = { readable: "已提取正文", empty: "未提取到正文", unsupported: "暂不支持读取", unknown: "未知" };
const robotsLabels: Record<PageSnapshot["robots"]["status"], string> = { available: "已读取规则", not_found: "未找到规则", unavailable: "规则读取失败", blocked: "无法检查规则", unknown: "未知" };

function pageInputs(pages: EditablePage[]) { return pages.map(({ id, url, label }) => ({ ...(id ? { id } : {}), url, label })); }
function displayDate(value: string | null) { return value ? formatProjectDate(value) : "未知"; }
function noindexText(value: boolean | null) { return value === true ? "观察到 noindex" : value === false ? "未观察到通用 noindex" : "未知"; }

export function PagesPanel(props: Props) { return <PagesEditor key={props.projectId} {...props} />; }

function PagesEditor({ projectId, onDirtyChange }: Props) {
  const baseUrl = `/api/projects/${encodeURIComponent(projectId)}/pages`;
  const [collection, setCollection] = useState<PageCollection | null>(null);
  const [pages, setPages] = useState<EditablePage[]>([]);
  const [baseline, setBaseline] = useState("[]");
  const [latestSnapshots, setLatestSnapshots] = useState<PageSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingPageId, setCheckingPageId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [messageWarning, setMessageWarning] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [historyPage, setHistoryPage] = useState<SelectedPage | null>(null);
  const [history, setHistory] = useState<PageSnapshotSummary[]>([]);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [collectionVersions, setCollectionVersions] = useState<PageCollection[] | null>(null);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const checkController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(pageInputs(pages)) !== baseline;
  const busy = saving || checkingPageId !== null;

  const applyCollection = useCallback((next: PageCollection) => {
    setCollection(next);
    const editable = next.pages.map((page) => ({ ...page, clientKey: page.id }));
    setPages(editable); setBaseline(JSON.stringify(pageInputs(editable))); setConflict(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    projectApi<PageCollectionResponse>(baseUrl, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { applyCollection(result.collection); setLatestSnapshots(result.latestSnapshots); } })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "页面选择读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applyCollection, baseUrl, attempt]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => () => { checkController.current?.abort(); historyController.current?.abort(); }, []);
  useEffect(() => {
    if (!dirty) return;
    function beforeExit(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", beforeExit);
    return () => window.removeEventListener("beforeunload", beforeExit);
  }, [dirty]);

  function reloadCollection() {
    if (dirty && !window.confirm("页面选择有未保存的修改，确定放弃并读取最新配置吗？")) return;
    setLoading(true); setError(""); setMessage(""); setCollectionVersions(null); setAttempt((value) => value + 1);
  }

  function changePage(index: number, patch: Partial<EditablePage>) {
    setPages((items) => items.map((page, position) => position === index ? { ...page, ...patch } : page)); setMessage("");
  }

  async function savePages() {
    if (!collection || busy || !dirty) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const result = await projectApi<{ collection: PageCollection }>(baseUrl, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: collection.version, pages: pageInputs(pages) }),
      });
      applyCollection(result.collection);
      setCollectionVersions((previous) => previous ? [result.collection, ...previous] : null);
      setMessageWarning(false);
      setMessage(`页面选择 V${result.collection.version} 已保存。检查会使用这份已保存配置，历史快照继续保留。`);
      try {
        const latest = await projectApi<PageCollectionResponse>(baseUrl);
        setLatestSnapshots(latest.latestSnapshots);
      } catch { setError("页面选择已保存，但最近检查记录未能刷新。请重新读取状态核对。"); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败，当前页面选择已保留。");
      setConflict(failure instanceof ApiFailure && failure.status === 409);
    } finally { setSaving(false); }
  }

  async function checkPage(page: SelectedPage) {
    if (busy || dirty) return;
    const controller = new AbortController(); checkController.current = controller;
    setCheckingPageId(page.id); setError(""); setMessage("");
    try {
      const result = await projectApi<{ snapshot: PageSnapshot }>(`${baseUrl}/${encodeURIComponent(page.id)}/check`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: controller.signal,
      });
      setLatestSnapshots((items) => [result.snapshot, ...items.filter((item) => item.pageId !== page.id)]);
      setMessageWarning(result.snapshot.status !== "success" || result.snapshot.bodyReadable !== "readable");
      setMessage(`本次检查已保存：${statusLabels[result.snapshot.status]}。请结合正文、访问控制信号和失败原因查看，不代表 AI 已抓取或收录。`);
    } catch (failure) {
      setError(controller.signal.aborted ? "已停止等待，本次后台检查结果仍待核对。请刷新状态查看实际记录。" : failure instanceof Error ? failure.message : "页面检查未完成，请刷新状态核对。");
    } finally {
      checkController.current = null; setCheckingPageId(null);
      try {
        const latest = await projectApi<PageCollectionResponse>(baseUrl);
        setLatestSnapshots(latest.latestSnapshots);
      } catch { /* Keep the last known evidence; a refresh remains available. */ }
    }
  }

  async function openHistory(page: SelectedPage) {
    historyController.current?.abort();
    const controller = new AbortController(); historyController.current = controller;
    setHistoryPage(page); setHistory([]); setSnapshot(null); setHistoryError(""); setHistoryBusy(true);
    try {
      const result = await projectApi<{ snapshots: PageSnapshotSummary[] }>(`${baseUrl}/${encodeURIComponent(page.id)}/snapshots`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setHistory(result.snapshots);
      if (result.snapshots[0]) {
        const detail = await projectApi<{ snapshot: PageSnapshot }>(`${baseUrl}/${encodeURIComponent(page.id)}/snapshots/${encodeURIComponent(result.snapshots[0].id)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setSnapshot(detail.snapshot);
      }
    } catch (failure) { if (!controller.signal.aborted) setHistoryError(failure instanceof Error ? failure.message : "快照读取失败。"); }
    finally { if (!controller.signal.aborted) setHistoryBusy(false); }
  }

  async function selectSnapshot(id: string) {
    if (!historyPage || historyBusy) return;
    historyController.current?.abort();
    const controller = new AbortController(); historyController.current = controller;
    setHistoryBusy(true); setHistoryError(""); setSnapshot(null);
    try {
      const result = await projectApi<{ snapshot: PageSnapshot }>(`${baseUrl}/${encodeURIComponent(historyPage.id)}/snapshots/${encodeURIComponent(id)}`, { signal: controller.signal });
      if (!controller.signal.aborted) setSnapshot(result.snapshot);
    } catch (failure) { if (!controller.signal.aborted) setHistoryError(failure instanceof Error ? failure.message : "快照详情读取失败。"); }
    finally { if (!controller.signal.aborted) setHistoryBusy(false); }
  }

  async function loadCollectionVersions() {
    if (versionsBusy) return;
    setVersionsBusy(true); setVersionsError("");
    try { setCollectionVersions((await projectApi<{ versions: PageCollection[] }>(`${baseUrl}/versions`)).versions); }
    catch (failure) { setVersionsError(failure instanceof Error ? failure.message : "页面选择历史读取失败。"); }
    finally { setVersionsBusy(false); }
  }

  return (
    <section className="form-panel" aria-labelledby="pages-title">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><span className="eyebrow">PUBLIC PAGE CHECK</span><h2 id="pages-title" className="mt-2 text-xl font-semibold text-[#304338]">公开页面访问检查</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[#667361]">选择最多 10 个页面，查看公开访问、正文读取及访问控制信号。页面可访问，不代表目标 AI 平台已抓取或收录。</p></div>{collection && <span className="version-tag">页面选择 V{collection.version}</span>}</header>
      {loading ? <p className="mt-7 flex items-center gap-2 text-sm text-[#667361]" role="status"><span className="spinner" />正在读取页面选择与检查记录…</p> : !collection ? <div className="mt-6"><p className="text-sm text-[#a65f45]" role="alert">{error || "页面配置尚未就绪。"}</p><Button type="button" className="mt-3" onClick={reloadCollection}><ReloadIcon />重新读取</Button></div> : <>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-[#e6eade] py-4"><p className="text-sm text-[#667361]">已选择 <strong>{pages.length} / 10</strong> 个页面{dirty ? " · 有未保存修改" : collection.version > 0 ? ` · 保存于 ${displayDate(collection.updatedAt)}` : " · 尚未配置"}</p><div className="flex gap-2"><Button type="button" variant="ghost" size="small" disabled={busy} onClick={reloadCollection}><ReloadIcon />刷新状态</Button><Button type="button" variant="secondary" size="small" disabled={busy || pages.length >= 10} onClick={() => { setPages((items) => [...items, { clientKey: crypto.randomUUID(), url: "", label: "" }]); setMessage(""); }}><PlusIcon />添加页面</Button></div></div>
        {message && <div className={`feedback-banner ${messageWarning ? "feedback-error" : "feedback-success"} mt-4`} role="status">{message}</div>}
        {error && <div className="feedback-banner feedback-error mt-4" role="alert"><div><p>{error}</p>{conflict && <Button type="button" variant="secondary" size="small" onClick={reloadCollection}>读取最新页面选择</Button>}</div></div>}
        {!pages.length ? <div className="py-9 text-center"><p className="font-medium text-[#405144]">先选择需要观察的公开页面</p><p className="mt-2 text-sm text-[#667361]">例如官网首页、产品介绍和重要业务说明。保存后可逐页检查并保留快照。</p></div> : <div className="mt-5 space-y-4">{pages.map((page, index) => {
          const latest = page.id ? latestSnapshots.find((item) => item.pageId === page.id) : undefined;
          const savedPage = collection.pages.find((item) => item.id === page.id);
          const thisChecking = checkingPageId === page.id;
          const oldUrl = latest && latest.requestedUrl !== page.url;
          return <article key={page.clientKey} className="rounded-lg border border-[#e2e8dc] bg-[#fafcf7] p-4 sm:p-5" aria-label={`第 ${index + 1} 个公开页面`}>
            <div className="mb-4 flex items-center justify-between"><strong className="text-sm text-[#405144]">页面 {String(index + 1).padStart(2, "0")}</strong><Button type="button" variant="ghost" size="icon" aria-label={`移除第 ${index + 1} 个页面`} disabled={busy} onClick={() => { setPages((items) => items.filter((_, position) => position !== index)); setMessage(""); }}><TrashIcon /></Button></div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><label className="field"><span>页面说明（可选）</span><input disabled={busy} maxLength={200} value={page.label} onChange={(event) => changePage(index, { label: event.target.value })} placeholder="例如：产品介绍" /></label><label className="field"><span>公开页面网址</span><input type="url" disabled={busy} maxLength={2048} value={page.url} onChange={(event) => changePage(index, { url: event.target.value })} placeholder="https://你的官网/产品页面" /></label></div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button type="button" size="small" disabled={busy || dirty || !savedPage} onClick={() => { if (savedPage) void checkPage(savedPage); }}>{thisChecking ? <span className="spinner" /> : <ReloadIcon />}{thisChecking ? "检查进行中…" : "检查这个页面"}</Button>{savedPage && <Button type="button" variant="secondary" size="small" onClick={() => void openHistory(savedPage)}><ClockIcon />快照历史</Button>}</div><span className="text-xs text-[#667361]">{thisChecking ? "正在获取公开响应，请稍候。" : !savedPage || dirty ? "先保存页面选择，再开始检查" : latest ? `最近检查：${displayDate(latest.checkedAt)}` : "尚无检查记录"}</span></div>
            {thisChecking && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#edf4ec] px-3 py-2 text-xs text-[#4d775c]" role="status"><span>等待实际响应，尚未得到最终检查结论。</span><Button type="button" variant="ghost" size="small" onClick={() => checkController.current?.abort()}>停止等待</Button></div>}
            {latest && <div className="mt-4 border-t border-[#e2e8dc] pt-4"><div className="mb-3 flex flex-wrap items-center gap-2"><span className={`status-pill ${latest.status === "success" ? "status-confirmed" : "status-pending"}`}>{statusLabels[latest.status]}</span>{oldUrl && <span className="text-xs text-[#91672d]">最近快照来自旧网址，需重新检查当前页面</span>}</div><SnapshotSignals snapshot={latest} />{latest.error && <p className="mt-3 text-sm text-[#a65f45]">{latest.error.message}</p>}{latest.status === "running" && <p className="mt-3 text-xs text-[#667361]">这条记录还没有最终结果，请刷新状态核对，不能作为访问正常的依据。</p>}</div>}
          </article>;
        })}</div>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#e2e8dc] pt-5"><p className="max-w-2xl text-xs leading-5 text-[#667361]">{dirty ? "当前修改尚未保存，检查按钮暂不可用。" : "每次检查单独保存快照；失败、未知和无法读取正文都保留原状，不当作空内容或正常访问。"} 移除页面不会删除它已有的检查快照。</p><Button type="button" disabled={busy || !dirty || conflict} onClick={() => void savePages()}>{saving ? <span className="spinner" /> : <CheckIcon />}保存页面选择</Button></div>

        {historyPage && <section className="mt-7 rounded-lg border border-[#d8e1d2] bg-white p-4 sm:p-5" aria-labelledby="page-history-title"><header className="flex items-start justify-between gap-3"><div><h3 id="page-history-title" className="font-semibold text-[#405144]">页面快照历史</h3><p className="mt-1 break-all text-xs text-[#667361]">{historyPage.label || historyPage.url}</p><p className="mt-1 text-xs text-[#667361]">最近 100 条记录，选择快照查看当时的响应和观察信号。</p></div><Button type="button" variant="ghost" size="icon" aria-label="关闭页面快照历史" onClick={() => { historyController.current?.abort(); setHistoryPage(null); }}><Cross2Icon /></Button></header>{historyError && <div className="mt-4 text-sm text-[#a65f45]" role="alert"><p>{historyError}</p><Button type="button" variant="secondary" size="small" onClick={() => void openHistory(historyPage)}>重新读取</Button></div>}{historyBusy && <p className="mt-4 flex items-center gap-2 text-sm text-[#667361]" role="status"><span className="spinner" />正在读取快照…</p>}{!historyBusy && !historyError && !history.length && <p className="mt-4 text-sm text-[#667361]">此页面尚无检查快照。</p>}{history.length > 0 && <label className="field mt-4"><span>选择检查快照</span><select className={controlClass} value={snapshot?.id ?? ""} disabled={historyBusy} onChange={(event) => void selectSnapshot(event.target.value)}>{!snapshot && <option value="">请选择快照</option>}{history.map((item) => <option key={item.id} value={item.id}>#{item.revision} · {displayDate(item.checkedAt)} · {statusLabels[item.status]}</option>)}</select></label>}{snapshot && !historyBusy && <SnapshotDetail snapshot={snapshot} />}</section>}

        <details className="mt-7 border-t border-[#e2e8dc] pt-5" onToggle={(event) => { if (event.currentTarget.open && collectionVersions === null && !versionsBusy) void loadCollectionVersions(); }}><summary className="cursor-pointer text-sm font-medium text-[#405144]">以前的页面选择记录</summary><p className="mt-2 text-xs leading-5 text-[#667361]">可查看最近 100 版选择记录，并打开已移除页面保留的快照。</p>{versionsBusy ? <p className="mt-4 text-sm text-[#667361]" role="status">正在读取…</p> : versionsError ? <p className="mt-4 text-sm text-[#a65f45]" role="alert">{versionsError} <button type="button" className="underline" onClick={() => void loadCollectionVersions()}>重试</button></p> : collectionVersions?.length ? <div className="mt-4 space-y-3">{collectionVersions.map((version) => <details key={version.version} className="rounded-md border border-[#e2e8dc] p-3"><summary className="cursor-pointer text-sm text-[#405144]">V{version.version} · {displayDate(version.updatedAt)} · {version.pages.length} 页</summary>{version.pages.length ? <ul className="mt-3 space-y-2">{version.pages.map((page) => <li key={page.id} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="min-w-0 break-all text-[#667361]">{page.label || page.url}</span><Button type="button" variant="ghost" size="small" onClick={() => void openHistory(page)}>查看历史快照</Button></li>)}</ul> : <p className="mt-3 text-xs text-[#667361]">此版没有选择页面。</p>}</details>)}</div> : <p className="mt-4 text-sm text-[#667361]">尚无保存记录。</p>}</details>
      </>}
    </section>
  );
}

function SnapshotSignals({ snapshot }: { snapshot: PageSnapshotSummary }) {
  return <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs sm:grid-cols-4"><div><dt className="text-[#7a8574]">HTTP 状态</dt><dd className="mt-1 font-medium text-[#405144]">{snapshot.httpStatus ?? "未知"}</dd></div><div><dt className="text-[#7a8574]">正文读取</dt><dd className="mt-1 font-medium text-[#405144]">{readabilityLabels[snapshot.bodyReadable]}</dd></div><div><dt className="text-[#7a8574]">robots 规则</dt><dd className="mt-1 font-medium text-[#405144]">{robotsLabels[snapshot.robots.status]}</dd></div><div><dt className="text-[#7a8574]">索引控制信号</dt><dd className="mt-1 font-medium text-[#405144]">{noindexText(snapshot.indexControl.generalNoindex)}</dd></div></dl>;
}

function SnapshotDetail({ snapshot }: { snapshot: PageSnapshot }) {
  return <div className="mt-5 space-y-5">
    <div className="rounded-md bg-[#f4f7ef] p-4"><p className="text-sm font-medium text-[#405144]">{snapshot.title || snapshot.label || "页面响应快照"}</p><p className="mt-2 break-all text-xs text-[#667361]">请求网址：{snapshot.requestedUrl}</p><p className="mt-1 break-all text-xs text-[#667361]">最终网址：{snapshot.finalUrl || "未知"}</p><p className="mt-1 text-xs leading-5 text-[#667361]">检查于 {displayDate(snapshot.checkedAt)}，结束于 {displayDate(snapshot.completedAt)} · 快照 #{snapshot.revision} · 页面选择 V{snapshot.collectionVersion} · 企业资料 V{snapshot.projectVersion}</p><p className="mt-2 text-xs leading-5 text-[#667361]">页面可访问以及未观察到阻断信号，都不能证明目标 AI 平台已抓取或收录。</p></div>
    <div className="flex items-center gap-2"><span className={`status-pill ${snapshot.status === "success" ? "status-confirmed" : "status-pending"}`}>{statusLabels[snapshot.status]}</span><span className="text-xs text-[#667361]">响应{snapshot.bodyComplete ? "已完整读取" : "未确认完整"}</span></div>
    <SnapshotSignals snapshot={snapshot} />
    {snapshot.error && <p className="rounded-md bg-[#fff5ee] p-3 text-sm text-[#a65f45]">{snapshot.error.message}</p>}
    {snapshot.observations.length > 0 && <div><h4 className="text-sm font-medium text-[#405144]">观察到的信号</h4><ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-6 text-[#667361]">{snapshot.observations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    <section><h4 className="text-sm font-medium text-[#405144]">提取的正文</h4>{snapshot.text !== null ? <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[#e2e8dc] bg-[#fafcf7] p-4 font-sans text-sm leading-7 text-[#405144]">{snapshot.text || "本次未提取到可读正文，不能据此认定页面没有内容。"}</pre> : <p className="mt-2 text-sm leading-6 text-[#667361]">没有取得可用正文；失败或读取能力不足保持未知，不以空内容代替。</p>}</section>
    <details className="rounded-md border border-[#e2e8dc] p-3"><summary className="cursor-pointer text-sm font-medium text-[#405144]">robots 与索引控制详情</summary><div className="mt-3 space-y-2 text-xs leading-6 text-[#667361]"><p>robots 请求：{snapshot.robots.url}</p><p>HTTP：{snapshot.robots.httpStatus ?? "未知"} · 检查于 {displayDate(snapshot.robots.checkedAt)}</p><p>对本次抓取器 {snapshot.robots.crawlerAgent} 的规则：{snapshot.robots.crawlerAccess === "allowed" ? "允许" : snapshot.robots.crawlerAccess === "disallowed" ? "阻止" : "未知"}。不同抓取器可能适用不同规则。</p>{snapshot.robots.reason && <p>{snapshot.robots.reason}</p>}<p>X-Robots-Tag：{snapshot.indexControl.xRobotsTag || "未取得或未设置"}</p>{snapshot.indexControl.meta.length > 0 ? <ul>{snapshot.indexControl.meta.map((item, index) => <li key={index}>Meta {item.agent}：{item.content}</li>)}</ul> : <p>未记录 Meta 索引控制标签；结合响应完整性判断。</p>}<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[#fafcf7] p-3">{snapshot.robots.body ?? "没有可用的 robots 原文。"}</pre></div></details>
    <details className="rounded-md border border-[#e2e8dc] p-3"><summary className="cursor-pointer text-sm font-medium text-[#405144]">响应原文（只读文本）</summary><p className="mt-2 text-xs leading-5 text-[#667361]">以下内容按文本展示，不执行网页脚本。正文类型：{snapshot.contentType || "未知"} · 实际读取字节：{snapshot.bytesRead ?? "未知"}</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#fafcf7] p-3 text-xs leading-6 text-[#405144]">{snapshot.rawBody ?? "未保存可用响应原文。"}</pre></details>
    {snapshot.redirects.length > 0 && <details className="rounded-md border border-[#e2e8dc] p-3"><summary className="cursor-pointer text-sm font-medium text-[#405144]">公开跳转记录</summary><ol className="mt-3 space-y-3 text-xs text-[#667361]">{snapshot.redirects.map((redirect, index) => <li key={index} className="break-all"><span className="inline-flex items-center gap-1"><ExternalLinkIcon />{redirect.status}</span> {redirect.url}<br />跳转目标：{redirect.location}</li>)}</ol></details>}
  </div>;
}

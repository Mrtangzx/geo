"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BarChartIcon, CheckCircledIcon, CheckIcon, ChevronDownIcon, ClockIcon, Cross2Icon, ExclamationTriangleIcon, FileTextIcon, GlobeIcon, HomeIcon, InfoCircledIcon, MagnifyingGlassIcon, PlusIcon, ReloadIcon, RocketIcon } from "@radix-ui/react-icons";
import type { Project } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { ProjectForm, draftToInput, emptyProjectDraft, projectToDraft, type ProjectDraft } from "@/components/project-form";
import { ProjectHistory } from "@/components/project-history";
import { ApiFailure, formatProjectDate, projectApi } from "@/components/project-api";
import { QuestionsPanel } from "@/components/questions-panel";
import { PagesPanel } from "@/components/pages-panel";
import { AuthStatus } from "@/components/auth-status";
import { SamplingPanel } from "@/components/sampling-panel";
import { TasksPanel } from "@/components/tasks-panel";
import { ReportsPanel } from "@/components/reports-panel";

interface SessionSummary {
  mode: "local" | "invite";
  user: { id: string; name: string; email: string } | null;
  workspace: { id: string; name: string } | null;
  needsLogin: boolean;
}

type WorkspaceSection = "brand" | "checks" | "tasks" | "reports";
const navigation = [
  { id: "brand" as const, label: "品牌资料", icon: HomeIcon, description: "建立品牌与事实依据" },
  { id: "checks" as const, label: "检查结果", icon: MagnifyingGlassIcon, description: "查看回答、引用与诊断证据" },
  { id: "tasks" as const, label: "修改任务", icon: FileTextIcon, description: "审核建议，核验公开上线" },
  { id: "reports" as const, label: "复查报告", icon: BarChartIcon, description: "按实际日期持续观察变化" },
];

export function BrandWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>(emptyProjectDraft);
  const [baseline, setBaseline] = useState<ProjectDraft>(emptyProjectDraft);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [section, setSection] = useState<WorkspaceSection>("brand");
  const [featureDirty, setFeatureDirty] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const hasUnsavedChanges = dirty || featureDirty;
  const confirmedCount = draft.facts.filter((fact) => fact.status === "confirmed").length;
  const pendingCount = draft.facts.length - confirmedCount;
  const currentSection = navigation.find((item) => item.id === section)!;

  const applyProject = useCallback((nextProject: Project | null) => {
    const nextDraft = nextProject ? projectToDraft(nextProject) : emptyProjectDraft();
    setProject(nextProject);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setSaveError("");
    setConflict(false);
    setSavedMessage("");
    setFeatureDirty(false);
  }, []);

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await projectApi<{ projects: Project[] }>("/api/projects", { signal });
      setProjects(result.projects);
      applyProject(result.projects[0] ?? null);
    } catch (failure) {
      if (!signal?.aborted) setLoadError(failure instanceof Error ? failure.message : "品牌资料读取失败。");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [applyProject]);

  useEffect(() => {
    const controller = new AbortController();
    projectApi<SessionSummary>("/api/session", { signal: controller.signal })
      .then((summary) => { if (!controller.signal.aborted) setSessionSummary(summary); })
      .catch(() => { /* The protected project request shows configuration or authentication errors. */ });
    projectApi<{ projects: Project[] }>("/api/projects", { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setProjects(result.projects);
        applyProject(result.projects[0] ?? null);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : "品牌资料读取失败。");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applyProject]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function preventAccidentalExit(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", preventAccidentalExit);
    return () => window.removeEventListener("beforeunload", preventAccidentalExit);
  }, [hasUnsavedChanges]);

  function canDiscardChanges() {
    return !hasUnsavedChanges || window.confirm("当前有未保存的修改。确定放弃这些修改吗？");
  }

  function selectSection(nextSection: WorkspaceSection) {
    if (nextSection === section) return;
    if (featureDirty && !canDiscardChanges()) return;
    setFeatureDirty(false);
    setSection(nextSection);
  }

  function startNewProject() {
    if (!canDiscardChanges()) return;
    applyProject(null);
    setSection("brand");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function selectProject(id: string) {
    if (id === project?.id) return;
    if (!id) { startNewProject(); return; }
    if (!canDiscardChanges()) return;
    setSwitching(true);
    try {
      const result = await projectApi<{ project: Project }>(`/api/projects/${encodeURIComponent(id)}`);
      applyProject(result.project);
      setProjects((items) => items.map((item) => item.id === id ? result.project : item));
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "项目读取失败，已保留当前内容。");
    } finally { setSwitching(false); }
  }

  async function reloadLatestProject() {
    if (!project || !canDiscardChanges()) return;
    setSwitching(true);
    try {
      const result = await projectApi<{ project: Project }>(`/api/projects/${encodeURIComponent(project.id)}`);
      applyProject(result.project);
      setProjects((items) => items.map((item) => item.id === result.project.id ? result.project : item));
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "最新版本读取失败。");
    } finally { setSwitching(false); }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || switching || (project && !dirty)) return;
    setSaving(true);
    setSaveError("");
    setSavedMessage("");
    try {
      const body = { ...draftToInput(draft), ...(project ? { expectedVersion: project.version } : {}) };
      const result = await projectApi<{ project: Project }>(project ? `/api/projects/${encodeURIComponent(project.id)}` : "/api/projects", {
        method: project ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      applyProject(result.project);
      setProjects((items) => items.some((item) => item.id === result.project.id) ? items.map((item) => item.id === result.project.id ? result.project : item) : [result.project, ...items]);
      setSavedMessage(`第 ${result.project.version} 版资料已保存，历史内容可在「版本记录」中查看。`);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "保存失败，当前编辑内容已保留。");
      setConflict(failure instanceof ApiFailure && failure.status === 409);
    } finally { setSaving(false); }
  }

  async function startFixture() {
    if (!canDiscardChanges() || saving || switching) return;
    setSwitching(true); setSaveError("");
    try {
      const { seed } = await projectApi<{ seed: { projectId: string } }>("/api/synthetic-fixtures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmSynthetic: true }) });
      const [list, current] = await Promise.all([projectApi<{ projects: Project[] }>("/api/projects"), projectApi<{ project: Project }>(`/api/projects/${seed.projectId}`)]);
      setProjects(list.projects); applyProject(current.project); setSection("checks");
      setSavedMessage("已进入独立合成项目。原有项目未修改，所有演练材料均保留合成标记。");
    } catch (e) { setSaveError(e instanceof Error ? e.message : "合成项目未创建。"); }
    finally { setSwitching(false); }
  }

  function changeDraft(nextDraft: ProjectDraft) {
    setDraft(nextDraft);
    setSavedMessage("");
  }

  const busy = saving || switching;

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">跳转到主要内容</a>
      <aside className="workspace-sidebar">
        <Link className="wordmark" href="/" aria-label="GEO 品牌工作台首页" onClick={(event) => { if (!canDiscardChanges()) event.preventDefault(); }}><span className="wordmark-symbol">g<span>.</span></span><span>GEO<span className="wordmark-subtitle">品牌工作台</span></span></Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="local-workspace"><span className="workspace-avatar">{sessionSummary?.workspace?.name.slice(0, 1) || "工"}</span><span><strong>{sessionSummary?.workspace?.name || "品牌工作区"}</strong><small>{sessionSummary?.mode === "invite" ? "受邀访问" : "本地研发预览"}</small></span></div>
        <div className="sidebar-divider" />
        <nav className="primary-navigation" aria-label="主导航">{navigation.map((item) => <button key={item.id} type="button" className={section === item.id ? "navigation-item navigation-item-active" : "navigation-item"} onClick={() => selectSection(item.id)} aria-current={section === item.id ? "page" : undefined}><item.icon /><span>{item.label}</span></button>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-scope"><span className="scope-dot" />{sessionSummary?.mode === "invite" ? "邀请访问模式" : "本机访问模式"}</div><p>先建立可信资料，<br />再观察真实回答。</p><span className="sidebar-version">MVP · R2 开发阶段</span></div>
      </aside>

      <div className="workspace-content">
        <header className="topbar"><div className="breadcrumb"><span>工作台</span><span className="breadcrumb-separator">/</span><strong>{currentSection.label}</strong></div><div className="topbar-right"><AuthStatus onBeforeSignOut={canDiscardChanges} /></div></header>
        <main id="workspace-main" className="workspace-main">
          <div className="page-heading"><div><span className="eyebrow">BRAND WORKSPACE</span><h1>{currentSection.label}<span className="heading-period">.</span></h1><p>{section === "brand" ? "从真实业务出发，建立品牌与事实的共同依据。" : currentSection.description}</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => void startFixture()} disabled={loading || !!loadError || busy}>进入合成资料演练</Button>{section === "brand" && <Button type="button" variant="secondary" onClick={startNewProject} disabled={loading || !!loadError || busy}><PlusIcon />新建项目</Button>}</div></div>

          {loading ? <div className="loading-panel" role="status"><span className="spinner" /><h2>正在读取品牌项目</h2><p>连接资料服务，获取已保存的版本。</p></div> : loadError ? <section className="connection-error"><span className="connection-error-icon"><ExclamationTriangleIcon /></span><span className="eyebrow">资料服务待连接</span><h2>{sessionSummary?.needsLogin ? "请登录后继续" : "暂时无法读取品牌资料"}</h2><p role="alert">{loadError}</p><p className="muted-text">{sessionSummary?.needsLogin ? "使用受邀账号登录后，即可进入自己的品牌工作区。" : "请确认资料服务与数据库配置已就绪，然后重新连接。"}</p>{sessionSummary?.needsLogin ? <Link className="button button-primary" href="/login">受邀登录</Link> : <Button type="button" onClick={() => void loadProjects()}><ReloadIcon />重试连接</Button>}</section> : (
            <>
              <div className="project-toolbar"><div className="project-select-wrap"><span className="project-avatar">{(project?.name || "新").slice(0, 1)}</span><label><span className="visually-hidden">当前品牌项目</span><select value={project?.id || ""} onChange={(event) => void selectProject(event.target.value)} disabled={busy}><option value="">{projects.length ? "创建新品牌项目" : "首个品牌项目"}</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><ChevronDownIcon /></div><div className="project-toolbar-meta">{project ? <><span className="version-tag">V{project.version}</span><span className="project-updated">更新于 {formatProjectDate(project.updatedAt)}</span><Button type="button" variant="ghost" size="small" onClick={() => setHistoryOpen(true)} disabled={busy}><ClockIcon />版本记录</Button></> : <span className="new-project-label">首次保存后建立资料版本</span>}</div></div>
              {savedMessage && <div className="feedback-banner feedback-success" role="status"><CheckCircledIcon /><span>{savedMessage}</span><button type="button" aria-label="关闭保存提示" onClick={() => setSavedMessage("")}><Cross2Icon /></button></div>}
              {saveError && <div className="feedback-banner feedback-error" role="alert"><ExclamationTriangleIcon /><div><strong>{conflict ? "资料已被更新，请先核对最新版本" : "操作未完成"}</strong><p>{saveError}</p><p>当前编辑内容已保留。</p>{conflict && <Button type="button" variant="secondary" size="small" onClick={() => void reloadLatestProject()} disabled={busy}>加载最新版本</Button>}</div>{!conflict && <button type="button" aria-label="关闭错误提示" onClick={() => setSaveError("")}><Cross2Icon /></button>}</div>}
              {section === "brand" ? <><form onSubmit={saveProject} className="brand-editor" aria-label={project ? `编辑 ${project.name} 的品牌资料` : "创建品牌项目"}>
                <div className="editor-main"><div className="editor-tabs"><a href="#basic-info">基础信息</a><a href="#competitors">竞品信息</a><a href="#business-facts">企业事实</a></div><ProjectForm draft={draft} onChange={changeDraft} disabled={busy} />
                  <div className="save-bar"><div className="save-state"><span className={dirty ? "unsaved-dot" : "saved-dot"} />{saving ? "正在保存资料…" : switching ? "正在读取项目…" : dirty ? "有未保存的修改" : project ? "当前资料已保存" : "新建品牌项目"}<small>{project ? `当前版本 V${project.version}` : "保存后可继续补充资料"}</small></div><Button type="submit" disabled={busy || !!conflict || (!!project && !dirty)}>{saving ? <span className="spinner" /> : <CheckIcon />}{saving ? "正在保存" : project ? "保存为新版本" : "创建品牌项目"}</Button></div>
                </div>
                <aside className="editor-aside">
                  <section className="summary-card"><span className="eyebrow">资料概览</span><h2>{draft.name.trim() || "你的品牌项目"}</h2><span className="summary-caption">{dirty ? "当前编辑内容 · 尚未保存" : project ? `已保存的第 ${project.version} 版资料` : "从一份清晰的品牌资料开始"}</span><div className="summary-stats"><div><strong>{confirmedCount}</strong><span>已确认事实</span></div><div><strong>{pendingCount}</strong><span>待确认事实</span></div></div><div className="summary-row"><span>竞品品牌</span><strong>{draft.competitors.length}<small> / 3</small></strong></div>{draft.isSynthetic && <div className="synthetic-banner">演示或合成资料</div>}</section>
                  <section className="preparation-card"><h3><RocketIcon />资料准备</h3><ul><li><span className={draft.name.trim() && draft.websiteUrl.trim() ? "preparation-check completed" : "preparation-check"}>{draft.name.trim() && draft.websiteUrl.trim() ? <CheckIcon /> : "1"}</span><div><strong>说明品牌是谁</strong><p>补充名称、官网和产品信息</p></div></li><li><span className={draft.targetCustomers.trim() ? "preparation-check completed" : "preparation-check"}>{draft.targetCustomers.trim() ? <CheckIcon /> : "2"}</span><div><strong>明确服务的客户</strong><p>描述行业、类型与业务需求</p></div></li><li><span className={confirmedCount > 0 ? "preparation-check completed" : "preparation-check"}>{confirmedCount > 0 ? <CheckIcon /> : "3"}</span><div><strong>确认有依据的事实</strong><p>待确认资料不会当作确定事实</p></div></li></ul></section>
                  <div className="evidence-note"><InfoCircledIcon /><p>每次保存都会保留独立版本。后续分析可追溯当时使用的资料。</p></div>
                  {project && <div className="project-scope"><GlobeIcon /><span>资料归属当前工作区</span></div>}
                </aside>
              </form>{project && <QuestionsPanel key={project.id} projectId={project.id} onDirtyChange={setFeatureDirty} />}</> : project ? section === "checks" ? <><SamplingPanel key={`sampling-${project.id}`} project={project} /><PagesPanel key={`pages-${project.id}`} projectId={project.id} onDirtyChange={setFeatureDirty} /></> : section === "tasks" ? <TasksPanel key={project.id} project={project} onDirtyChange={setFeatureDirty} /> : <ReportsPanel key={project.id} projectId={project.id} /> : <section className="upcoming-panel"><h2>先创建一个品牌项目</h2><p>保存品牌资料后，可为该项目选择公开页面并检查访问情况。</p><Button type="button" onClick={startNewProject}>创建品牌项目</Button></section>}
            </>
          )}
          <footer className="page-footer"><span>GEO 品牌工作台</span><span>{sessionSummary?.mode === "invite" ? "邀请内测" : "本地研发预览"} · 实际能力按验收结果逐步开放</span></footer>
        </main>
      </div>
      {historyOpen && project && <ProjectHistory key={`${project.id}-${project.version}`} project={project} open onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

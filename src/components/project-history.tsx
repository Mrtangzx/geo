"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, ClockIcon, Cross2Icon } from "@radix-ui/react-icons";
import type { Project, ProjectVersion } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { formatProjectDate, projectApi } from "@/components/project-api";

interface ProjectHistoryProps {
  project: Project | null;
  open: boolean;
  onClose: () => void;
}

export function ProjectHistory({ project, open, onClose }: ProjectHistoryProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !project) return;
    const controller = new AbortController();
    projectApi<{ versions: ProjectVersion[] }>(`/api/projects/${encodeURIComponent(project.id)}/versions`, { signal: controller.signal })
      .then((result) => {
        const sorted = [...result.versions].sort((left, right) => right.version - left.version);
        setVersions(sorted);
        setSelectedVersion(sorted[0]?.version ?? null);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "历史版本读取失败。");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, project, attempt]);

  const selected = versions.find((version) => version.version === selectedVersion);
  const snapshot = selected?.snapshot;

  return (
    <dialog ref={dialogRef} className="history-dialog" onCancel={onClose} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="history-title">
      <div className="history-dialog-inner">
        <header className="history-heading"><div className="history-heading-icon"><ClockIcon /></div><div><h2 id="history-title">资料历史版本</h2><p>{project?.name} · 历史快照只读保存</p></div><Button type="button" variant="ghost" size="icon" aria-label="关闭历史版本" onClick={onClose}><Cross2Icon /></Button></header>
        {loading ? <div className="history-state" role="status"><span className="spinner" />正在读取历史记录…</div> : error ? <div className="history-state"><p role="alert">{error}</p><Button type="button" variant="secondary" onClick={() => { setLoading(true); setError(""); setVersions([]); setSelectedVersion(null); setAttempt((value) => value + 1); }}>重新读取</Button></div> : versions.length === 0 ? <div className="history-state"><p>尚无可查看的版本记录。</p></div> : (
          <div className="history-body">
            <nav className="version-list" aria-label="选择资料版本">{versions.map((version) => <button key={version.version} type="button" className={selectedVersion === version.version ? "version-choice version-choice-active" : "version-choice"} aria-pressed={selectedVersion === version.version} onClick={() => setSelectedVersion(version.version)}><span><strong>V{version.version}</strong>{version.version === project?.version && <span className="latest-label">当前</span>}</span><time dateTime={version.createdAt}>{formatProjectDate(version.createdAt)}</time></button>)}</nav>
            {snapshot && <section className="version-snapshot" aria-label={`第 ${selectedVersion} 版资料快照`}>
              <div className="snapshot-top"><span className="eyebrow">只读资料快照</span><h3>{snapshot.name}</h3><p>保存于 {formatProjectDate(selected!.createdAt)}（北京时间）</p></div>
              {snapshot.isSynthetic && <div className="synthetic-banner">演示或合成资料</div>}
              <dl className="snapshot-details"><div><dt>官方网站</dt><dd>{snapshot.websiteUrl || "待补充"}</dd></div><div><dt>产品或服务</dt><dd>{snapshot.product || "待补充"}</dd></div><div><dt>目标客户</dt><dd>{snapshot.targetCustomers || "待补充"}</dd></div><div><dt>品牌别名</dt><dd>{snapshot.aliases.join("、") || "未填写"}</dd></div></dl>
              <h4 className="snapshot-section-title">竞品信息 <span>{snapshot.competitors.length} 项</span></h4>
              {snapshot.competitors.length ? <ul className="snapshot-competitors">{snapshot.competitors.map((competitor, index) => <li key={index}><strong>{competitor.name}</strong><span>{competitor.websiteUrl || "官网待补充"}</span></li>)}</ul> : <p className="muted-text">此版本未添加竞品。</p>}
              <h4 className="snapshot-section-title">企业事实 <span>{snapshot.facts.length} 项</span></h4>
              {snapshot.facts.length ? <div className="snapshot-facts">{snapshot.facts.map((fact) => <article key={fact.id}><div><span className={`status-pill ${fact.status === "confirmed" ? "status-confirmed" : "status-pending"}`}>{fact.status === "confirmed" ? "已确认" : "待确认"}</span><span className="snapshot-fact-id">{fact.id.slice(0, 8)}</span></div><p>{fact.statement}</p><small>依据：{fact.sourceUrl || fact.sourceRef || "待补充"}</small>{fact.confirmedAt && <small>确认于 {formatProjectDate(fact.confirmedAt)} · {fact.confirmedBy || "确认者未知"}</small>}</article>)}</div> : <p className="muted-text">此版本尚无企业事实，资料待补充。</p>}
            </section>}
          </div>
        )}
        <footer className="history-footer"><p>编辑资料会生成新版本，历史快照保留原有内容。</p><Button type="button" variant="secondary" size="small" onClick={onClose}><ArrowLeftIcon />返回编辑</Button></footer>
      </div>
    </dialog>
  );
}

"use client";

import { CheckCircledIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import type { FactInput, Project, ProjectInput } from "@/lib/contracts";
import { Button } from "@/components/ui/button";

interface DraftFact extends FactInput {
  clientKey: string;
}

export interface ProjectDraft extends Omit<ProjectInput, "aliases" | "facts"> {
  aliasesText: string;
  facts: DraftFact[];
}

export function emptyProjectDraft(): ProjectDraft {
  return {
    name: "", aliasesText: "", websiteUrl: "", product: "", targetCustomers: "",
    competitors: [], facts: [], isSynthetic: false,
  };
}

export function projectToDraft(project: Project): ProjectDraft {
  return {
    name: project.name,
    aliasesText: project.aliases.join("\n"),
    websiteUrl: project.websiteUrl,
    product: project.product,
    targetCustomers: project.targetCustomers,
    competitors: project.competitors.map((competitor) => ({ ...competitor })),
    facts: project.facts.map(({ id, statement, sourceUrl, status }) => ({ id, clientKey: id, statement, sourceUrl, status })),
    isSynthetic: project.isSynthetic,
  };
}

export function draftToInput(draft: ProjectDraft): ProjectInput {
  const { aliasesText, facts, ...input } = draft;
  return {
    ...input,
    aliases: aliasesText.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean),
    facts: facts.map((fact) => ({
      ...(fact.id ? { id: fact.id } : {}),
      statement: fact.statement,
      sourceUrl: fact.sourceUrl,
      status: fact.status,
    })),
  };
}

interface ProjectFormProps {
  draft: ProjectDraft;
  onChange: (draft: ProjectDraft) => void;
  disabled: boolean;
}

export function ProjectForm({ draft, onChange, disabled }: ProjectFormProps) {
  function update<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  function updateFact(index: number, changes: Partial<FactInput>) {
    update("facts", draft.facts.map((fact, current) => current === index ? { ...fact, ...changes } : fact));
  }

  return (
    <fieldset className="project-fields" disabled={disabled}>
      <section className="form-panel" id="basic-info" aria-labelledby="basic-title">
        <div className="panel-heading">
          <span className="section-number">01</span>
          <div><h2 id="basic-title">基础信息</h2><p>清楚描述你是谁、提供什么，以及服务谁。</p></div>
        </div>
        <div className="form-grid">
          <label className="field"><span>品牌名称 <span className="required-mark">*</span></span>
            <input name="name" required maxLength={120} autoComplete="organization" placeholder="企业或品牌的正式名称" value={draft.name} onChange={(event) => update("name", event.target.value)} />
          </label>
          <label className="field"><span>官方网站 <span className="required-mark">*</span></span>
            <input name="websiteUrl" required type="url" maxLength={2000} placeholder="https://www.example.com" value={draft.websiteUrl} onChange={(event) => update("websiteUrl", event.target.value)} />
          </label>
          <label className="field"><span>产品或服务 <span className="optional">可稍后补充</span></span>
            <textarea name="product" rows={3} maxLength={4000} placeholder="主要产品、核心用途与适用场景" value={draft.product} onChange={(event) => update("product", event.target.value)} />
          </label>
          <label className="field"><span>目标客户 <span className="optional">可稍后补充</span></span>
            <textarea name="targetCustomers" rows={3} maxLength={4000} placeholder="客户所在行业、企业类型与主要需求" value={draft.targetCustomers} onChange={(event) => update("targetCustomers", event.target.value)} />
          </label>
          <label className="field field-full"><span>品牌别名 <span className="optional">选填</span></span>
            <textarea name="aliases" rows={2} maxLength={3000} placeholder="常见简称、英文名或历史名称，每行一个" value={draft.aliasesText} onChange={(event) => update("aliasesText", event.target.value)} />
            <small>别名帮助识别回答中的品牌称呼，也可用中英文逗号分隔。</small>
          </label>
        </div>
        <label className="synthetic-option"><input type="checkbox" checked={draft.isSynthetic} onChange={(event) => update("isSynthetic", event.target.checked)} /><span><strong>此项目使用演示或合成资料</strong><small>开启后将明确标识，不能用于真实企业或消费端通道验收。</small></span></label>
      </section>

      <section className="form-panel" id="competitors" aria-labelledby="competitors-title">
        <div className="panel-heading panel-heading-actions">
          <span className="section-number">02</span>
          <div><h2 id="competitors-title">竞品信息 <span className="count-inline">{draft.competitors.length} / 3</span></h2><p>记录客户可能同时比较的品牌。</p></div>
          <Button type="button" variant="secondary" size="small" disabled={draft.competitors.length >= 3} onClick={() => update("competitors", [...draft.competitors, { name: "", websiteUrl: "" }])}><PlusIcon />添加竞品</Button>
        </div>
        {draft.competitors.length === 0 ? <div className="inline-empty"><span className="empty-line-icon"><PlusIcon /></span><p>尚未添加竞品</p><span>可以稍后补充，最多添加 3 个。</span></div> : (
          <div className="competitor-list">{draft.competitors.map((competitor, index) => (
            <div className="competitor-row" key={index}>
              <span className="row-number">{String(index + 1).padStart(2, "0")}</span>
              <label className="field"><span>竞品名称 <span className="required-mark">*</span></span><input required maxLength={120} value={competitor.name} placeholder="竞品的品牌名称" onChange={(event) => update("competitors", draft.competitors.map((item, current) => current === index ? { ...item, name: event.target.value } : item))} /></label>
              <label className="field"><span>官方网站 <span className="optional">选填</span></span><input type="url" maxLength={2000} value={competitor.websiteUrl} placeholder="https://" onChange={(event) => update("competitors", draft.competitors.map((item, current) => current === index ? { ...item, websiteUrl: event.target.value } : item))} /></label>
              <Button type="button" variant="ghost" size="icon" className="remove-button" aria-label={`移除竞品 ${competitor.name || index + 1}`} onClick={() => update("competitors", draft.competitors.filter((_, current) => current !== index))}><TrashIcon /></Button>
            </div>
          ))}</div>
        )}
      </section>

      <section className="form-panel" id="business-facts" aria-labelledby="facts-title">
        <div className="panel-heading panel-heading-actions">
          <span className="section-number">03</span>
          <div><h2 id="facts-title">企业事实 <span className="count-inline">{draft.facts.length} 项</span></h2><p>保留可追溯的依据，并区分已确认和待补充资料。</p></div>
          <Button type="button" variant="secondary" size="small" onClick={() => update("facts", [...draft.facts, { clientKey: crypto.randomUUID(), statement: "", sourceUrl: "", status: "needs_confirmation" }])}><PlusIcon />添加事实</Button>
        </div>
        <div className="fact-notice"><CheckCircledIcon /><span>后续判断以企业已确认的资料为依据。请先补充来源，再确认事实。</span></div>
        {draft.facts.length === 0 ? <div className="inline-empty facts-empty"><span className="empty-line-icon"><CheckCircledIcon /></span><p>从一条有依据的事实开始</p><span>例如产品能力、适用客户、部署条件或服务范围。</span><Button type="button" variant="ghost" size="small" onClick={() => update("facts", [{ clientKey: crypto.randomUUID(), statement: "", sourceUrl: "", status: "needs_confirmation" }])}><PlusIcon />添加第一条事实</Button></div> : (
          <div className="fact-list">{draft.facts.map((fact, index) => (
            <article className="fact-item" key={fact.clientKey}>
              <div className="fact-item-heading"><span className="fact-label">事实 {String(index + 1).padStart(2, "0")}</span><span className={`status-pill ${fact.status === "confirmed" ? "status-confirmed" : "status-pending"}`}>{fact.status === "confirmed" ? "已确认" : "待确认"}</span><Button type="button" variant="ghost" size="icon" aria-label={`移除第 ${index + 1} 条事实`} onClick={() => update("facts", draft.facts.filter((_, current) => current !== index))}><TrashIcon /></Button></div>
              <label className="field"><span>事实内容 <span className="required-mark">*</span></span><textarea required rows={2} maxLength={6000} placeholder="填写一项明确、可核对的业务陈述" value={fact.statement} onChange={(event) => updateFact(index, { statement: event.target.value, ...(fact.status === "confirmed" ? { status: "needs_confirmation" as const } : {}) })} /></label>
              <label className="field"><span>依据链接 {fact.status === "confirmed" ? <span className="required-mark">*</span> : <span className="optional">待确认时可稍后补充</span>}</span><input type="url" required={fact.status === "confirmed"} maxLength={2000} placeholder="https:// 可追溯的官网或产品资料链接" value={fact.sourceUrl} onChange={(event) => updateFact(index, { sourceUrl: event.target.value, ...(fact.status === "confirmed" ? { status: "needs_confirmation" as const } : {}) })} /></label>
              <label className="fact-confirm-option"><input type="checkbox" checked={fact.status === "confirmed"} disabled={!fact.statement.trim() || !fact.sourceUrl.trim()} onChange={(event) => updateFact(index, { status: event.target.checked ? "confirmed" : "needs_confirmation" })} /><span>企业已确认此事实及来源</span></label>
              {(!fact.statement.trim() || !fact.sourceUrl.trim()) && <p className="field-help">补充事实内容和依据链接后，才能标记为已确认。</p>}
            </article>
          ))}</div>
        )}
      </section>
    </fieldset>
  );
}

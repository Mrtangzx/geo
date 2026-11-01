import type { ReviewReport } from "@/lib/report-contracts";

function escape(value: unknown): string {
  return String(value ?? "未知").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function table(headers: string[], rows: unknown[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function percent(value: number | null | undefined): string { return value == null ? "暂无可判断数据" : `${value.toFixed(2)}%`; }

export function exportReportHtml(report: ReviewReport): string {
  const groups = report.metricsSnapshot.groups;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.projectSnapshot.name)} · GEO复查报告V${report.version}</title><style>body{font:14px/1.7 system-ui,sans-serif;color:#26362c;max-width:1100px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.35}h2{margin-top:36px;border-bottom:1px solid #cdd7ce;padding-bottom:8px}table{width:100%;border-collapse:collapse;overflow-wrap:anywhere;margin:16px 0}th,td{padding:9px;text-align:left;vertical-align:top;border:1px solid #dce3dc}th{background:#f3f6ef}pre,blockquote{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f8f4;padding:14px}.notice{border-left:4px solid #71885b;padding:12px 18px;background:#f2f5ec}.meta{color:#657263;font-size:12px}article{break-inside:avoid}@media print{body{margin:0;max-width:none}h2{break-after:avoid}thead{display:table-header-group}}</style></head><body>
<h1>${escape(report.projectSnapshot.name)} · GEO复查报告 V${report.version}</h1>
<p class="meta">报告ID ${escape(report.id)} · 生成于 ${escape(report.createdAt)}（UTC） · 项目时区 ${escape(report.timezone)}<br>资料V${report.projectSnapshot.version} · 指标快照 ${escape(report.metricsSnapshot.id)} · ${escape(report.metricsSnapshot.calculationVersion)} / ${escape(report.calculationVersion)}</p>
<div class="notice">${report.notes.map((note) => `<p>${escape(note)}</p>`).join("")}</div>
<h2>采样覆盖与指标口径</h2>
${table(["时期 / 问题组", "来源 / 平台 / 渠道", "计划 / 有效 / 失败 / 缺失 / 未分析", "明确推荐", "事实一致", "官网引用 / 引用覆盖"], groups.map((g) => [`${g.scope.period} / ${g.scope.group}${g.scope.isSynthetic ? "（合成）" : ""}`, `${g.scope.sourceType}\n${g.scope.platform}\n${g.scope.channelId}`, `${g.planned} / ${g.valid} / ${g.failed} / ${g.missing} / ${g.unanalysed}`, `${g.recommendation.numerator}/${g.recommendation.denominator} · ${percent(g.recommendation.percent)}`, `${g.facts.numerator}/${g.facts.denominator} · ${percent(g.facts.percent)}`, `${g.officialCitation.numerator}/${g.officialCitation.denominator} · ${percent(g.officialCitation.percent)}\n覆盖 ${g.citationCoverage.numerator}/${g.citationCoverage.denominator}`]))}
<p>推荐判断排除未知；事实一致率只计可判断业务陈述；正文引用完整且属于官网域名才计官网引用。候选来源列表不计正文引用。分母为0时没有百分比。</p>
<h2>发布与观察窗口</h2>
${table(["任务 / 发布版本", "全部条件通过时间（UTC）", "第7—9天", "第14—16天", "状态"], report.windows.map((w) => [`${w.taskId} / V${w.releaseVersion}`, w.verifiedAt, w.firstDates.join("、"), w.secondDates.join("、"), `${w.isSynthetic ? "合成观察 · " : ""}${w.state}`]))}
<h2>前后观察</h2>
${report.comparisons.map((c) => `<article><h3>${escape(c.period)} · ${escape(c.group)} · ${escape(c.platform)}${c.isSynthetic ? "（合成）" : ""}</h3><p>${c.status === "comparable" ? "当前资料满足比较要求" : "仅展示观察数据，暂不能形成完整改善结论"}；共同问题${c.questionIntersection.length}个。</p>${table(["指标", "基线", "复查", "变化（百分点）"], c.changes.map((delta) => [delta.metric, percent(delta.baseline), percent(delta.review), delta.percentagePoints == null ? "暂不能比较" : delta.percentagePoints.toFixed(2)]))}<p>基线日期：${escape(c.baselineDates.join("、"))}；复查日期：${escape(c.reviewDates.join("、"))}</p><ul>${c.limitations.map((limit) => `<li>${escape(limit)}</li>`).join("")}</ul>${c.exclusions.length ? table(["排除问题", "原因"], c.exclusions.map((item) => [item.questionId, item.reason])) : ""}<p>下一轮：${escape(c.nextActions.join("；"))}</p></article>`).join("") || "<p>还没有基线与复查数据。</p>"}
<h2>修改与核验记录</h2>
${report.tasks.map((task) => `<article><h3>${escape(task.title)} · V${task.revision}</h3><p>${escape(task.targetUrl)} · ${escape(task.state)}${task.isSynthetic ? " · 合成演练" : ""}</p><p>依据资料V${task.basis.projectVersion}；分析${escape(task.basis.analysisIds.join("、"))}；批准${escape(task.currentApprovalId)}。</p><blockquote>${escape(task.proposedText)}</blockquote>${table(["核验ID", "执行时间", "观察时间", "来源", "结果"], task.verifications.map((v) => [v.id, v.executedAt, v.observedAt, v.source, v.allPassed ? (v.isSynthetic ? "合成全部条件通过" : "全部条件通过") : "部分条件失败或未知"]))}</article>`).join("") || "<p>尚无修改任务。</p>"}
<h2>回答证据与标签版本</h2>
${report.evidence.map((evidence) => { const analysis = report.analyses.find((a) => a.evidenceId === evidence.id); return `<article><h3>${escape(evidence.questionText)}</h3><p class="meta">证据 ${escape(evidence.id)} · ${escape(evidence.sourceType)} / ${escape(evidence.platform)} · ${escape(evidence.collectedAt)}${evidence.isSynthetic ? " · 合成" : ""}<br>资料V${evidence.projectVersion} · 问题${escape(evidence.questionVersion)} · 配置${escape(evidence.configVersion)} · 分析${analysis ? `${escape(analysis.id)} / V${analysis.revision} / ${escape(analysis.mode)}` : "尚未分析"}</p><blockquote>${escape(evidence.answerText)}</blockquote><p>引用采集：${escape(evidence.citations.status)}；正文映射：${escape(evidence.citations.bodyMappings?.map((mapping) => `${mapping.quote} → ${mapping.url}`).join("\n") ?? "未知")}。</p></article>`; }).join("")}
<p class="meta">本文件来自已授权的工作区报告快照。观察变化不证明因果关系或统计显著性；外部回放链接可能失效，原始回答与标签版本以上述冻结依据为准。</p></body></html>`;
}

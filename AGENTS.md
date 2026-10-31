# 注意事项
- 每次改动完成后,都必须创建一个对应的Git commit,以便后后续追踪和回滚
- 每次改动后,都必须编写或更新相关测试,并在交付给用户前,确保所有测试和验证全部通过。

## 测试与验证

遵循用户最新规则：不新增测试代码，除非修复 bug 或用户主动要求。
其他改动通过适用的检查、构建和人工验收验证，记录实际验证范围。

## Agent skills

### Issue tracker
任务和规格使用 Mrtangzx/geo 的 GitHub Issues。
详见 docs/agents/issue-tracker.md。

### Triage labels
使用五个默认分诊标签。
详见 docs/agents/triage-labels.md。

### Domain docs
采用 single-context：根目录 GLOSSARY.md 和 docs/adr/。
详见 docs/agents/domain.md。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

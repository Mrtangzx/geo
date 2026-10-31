# geo
geo platform

## 本地运行

先执行 `./scripts/runtime/setup-local.ps1` 生成本机配置，启动 PostgreSQL 后运行 `npm ci`、`npm run db:migrate`、`npm run dev`。入口为 `http://127.0.0.1:3000`。详细步骤及 Windows 原生数据库备用方式见 [开发说明](docs/development.md)。

已完成本地品牌资料与企业事实管理，支持不可覆盖的历史版本。验证范围见 [#1 验收记录](docs/validation/issue-01.md)。真实通道及效果仍按任务分别验收。

## 测试资料

[GEO R2 测试资料包](test-materials/geo-r2/README.md)：虚构 B2B 软件企业、10 个问题、90 条基线及复查回答、页面快照、异常资料、标准答案和操作演练。当前仓库尚无平台实现，资料校验与平台验收分别记录。

## 项目资料

- [工程约定](AGENTS.md)
- [GEO MVP 任务索引](docs/planning/geo-mvp-issues.md)
- [项目关键信息](memory.md)

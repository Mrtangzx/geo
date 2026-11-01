# geo
geo platform

## 本地运行

先执行 `./scripts/runtime/setup-local.ps1` 生成本机配置，启动 PostgreSQL 后运行 `npm ci`、`npm run db:migrate`、`npm run dev`。入口为 `http://127.0.0.1:3000`。详细步骤及 Windows 原生数据库备用方式见 [开发说明](docs/development.md)。

已实现品牌资料与不可变历史、问题集确认版本、公开页面诊断和邀请登录隔离。现可进入合成资料演练，操作后台采样、回答标注、指标、修改核验和版本报告。后台处理还需在独立终端运行 `npm run worker`。验证范围见 [#1](docs/validation/issue-01.md)、[第二轮](docs/validation/wave-02.md)及[第三轮记录](docs/validation/wave-03.md)。当前按用户要求先用合成材料推进工程演练，真实通道及效果仍按任务分别验收。

## 测试资料

[GEO R2 测试资料包](test-materials/geo-r2/README.md)：虚构 B2B 软件企业、10 个问题、90 条基线及复查回答、页面快照、异常资料、标准答案和操作演练。资料推演与平台实测分别记录。

## 项目资料

- [工程约定](AGENTS.md)
- [GEO MVP 任务索引](docs/planning/geo-mvp-issues.md)
- [平台完成状态与剩余工作](docs/planning/platform-progress.md)
- [项目关键信息](memory.md)

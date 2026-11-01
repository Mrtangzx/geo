# 本地开发

本地单用户阶段使用 Node.js 24、Next.js 和真实 PostgreSQL 17。应用仅监听 `127.0.0.1`。数据库默认使用 `127.0.0.1:55432`，不向局域网开放。

## 准备配置

在项目根目录使用 PowerShell 7：

```powershell
./scripts/runtime/setup-local.ps1
```

脚本创建被 Git 忽略的 `.env.local`，为本项目生成随机数据库密码和 `DATABASE_URL`。已有配置不会被覆盖。若端口已占用，在首次生成时使用 `-Port 其他端口`。`.env.example` 只列出变量，不含可运行的公共密码。

## 启动数据库

先启动 Docker Desktop，再运行：

```powershell
./scripts/runtime/start-database.ps1
```

如果本机默认 Docker context 不是 Linux engine，可显式选择：

```powershell
./scripts/runtime/start-database.ps1 -DockerContext desktop-linux
```

数据库使用官方 `postgres:17-bookworm` 镜像和独立持久卷；脚本等待健康检查通过。启动失败时保留已有数据。首次拉取需要可访问 Docker Hub。不要把 `.env.local`、`DATABASE_URL` 或展开后的 Compose 配置复制到日志和工单。

### Windows 原生 PostgreSQL 备用方式

若 Docker 的 Linux engine 不可用，可在本机运行真实 PostgreSQL 17.11：

```powershell
npm ci --registry=https://registry.npmjs.org
./scripts/runtime/start-native-database.ps1
```

此脚本读取同一 `.env.local`，不改为内存数据库或 SQLite。首次运行从 npm 下载固定版本的 `@embedded-postgres/windows-x64` 平台二进制到用户缓存，在本项目 `.local/postgres-data-17` 初始化持久数据库，以 SCRAM 密码认证并仅监听 `127.0.0.1`。日志为 `.local/postgres-17.log`，本地运行数据均被 Git 忽略。脚本不会覆盖已有数据库或密码；重复运行复用当前项目的实例，并验证实际连接与数据库名称。

不要同时用 Compose 和原生方式占用同一端口；切换前先停止原实例。该备用方式仅用于本地开发，不作为对外部署方案。平台二进制说明见 [embedded-postgres 项目](https://github.com/leinelissen/embedded-postgres)。

## 依赖、迁移与应用

```powershell
npm ci --registry=https://registry.npmjs.org
npm run db:migrate
npm run dev
```

另开一个项目终端启动独立后台进程：

```powershell
npm run worker
```

worker 使用同一 PostgreSQL 的 `geo_jobs` pg-boss 队列，读取持久化采样任务。网页提交后返回任务 ID，不在 HTTP 请求里执行采样。worker 未启动时任务保持等待，不伪装已完成；重启优先检查保存的提交状态。当前每个数据库只允许一个活动恢复进程，避免两个 worker 同时误判对方处理中任务为中断；后续横向扩容需要改为带租约的逐任务恢复。

## 合成工程演练

1. 页面点击“进入合成资料演练”，显式建立独立项目并保留合成标记。不会修改已有品牌项目。
2. 在“检查结果”中选择基线、第一轮和第二轮，依次发起固定资料回放。每批30条，后台持久化后可查看原文、正文引用与来源候选；刷新相同批次复用任务和证据。
3. 点击“显式回放合成参考标注”，再生成指标快照。该路径读取独立标准答案，明确不是模型输出；真实模型配置检查只记录待配置，不发起付费请求。
4. 在“修改任务”生成五类固定演练建议，审核后申报发布，选择相同页面的快照核验。T01 的 `product-partial` 必须失败，`product-after` 才能全部通过；第三方提交保持等待。
5. 在“复查报告”生成独立版本，核对窗口、分子分母、未知项及限制，下载 HTML/JSON。真实日期、模型等条件不齐时仍为观察数据，不输出完整改善结论。

固定资料回放不消耗额度。另一运行方式“模拟采样与账本”使用独立模拟人民币账本，每条预留50分、正常结算40分；30条主周期上限15元，默认模拟额度也为0。仅本机操作员可设置模拟上限。真实账本保持0，受邀账号不能自行改额度。

结果不明保留预留并进入待核对，不自动重复提交；本机操作员的模拟核对入口明确展示每条费用和依据。限流适配会持久记录首次和最多两次退避重试；这不证明任何真实供应商的重试或费用行为。新增执行批次必须显式确认，重复原始资料仍不会变成新的统计样本。

本阶段还没有任意文件的人工证据导入、可执行的真实消费端/模型供应商适配、完整 Docker 应用交付及最终外部安全验收。见 [剩余工作](planning/platform-progress.md)，不能据上述步骤宣称完整平台已全部完成。

迁移与应用均读取 `.env.local`。开发入口为 `http://127.0.0.1:3000`。没有密钥、预算或已验收通道时保留待配置状态；本地运行数据库不代表已接入真实 AI 消费端。

修改数据库模型后使用 `npm run db:generate` 生成迁移，再运行 `npm run db:migrate`。提交迁移及对应实现，验证后按工作包创建 Git commit。

## 停止与保留数据

```powershell
docker compose --env-file .env.local stop postgres
```

`stop` 不删除持久卷。不要运行删除数据库目录或卷的命令来解决连接问题。若修改现有库的密码，需在数据库内同步修改账号密码；只改环境文件不会重新初始化已有数据。

使用原生备用方式时，停止当前项目实例：

```powershell
./scripts/runtime/stop-native-database.ps1
```

此命令只停止本项目的 PostgreSQL 进程并保留数据，下次运行 `start-native-database.ps1` 继续使用原数据。

## 验证范围

```powershell
npm run typecheck
npm run lint
npm run build
```

数据库连接、迁移和真实页面操作需分别验证并记录。新功能依照用户约定不新增测试代码；修复 bug 时补必要回归验证。已有 `test-materials/geo-r2/` 为合成资料，不能替代真实通道或企业效果验收。

参考：[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)、[Docker Compose 环境变量](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。

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

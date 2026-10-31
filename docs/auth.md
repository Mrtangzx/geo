# 邀请登录与工作区授权

本阶段在本机验证邀请账号和服务端隔离。外部试用还须通过后续 HTTPS、限流、备份恢复及部署安全验收。

## 两种访问模式

- `GEO_AUTH_MODE=local`：仅限 loopback 的单用户研发预览，服务端使用 `local-workspace` 和 `local-operator`。当前开发及启动命令仅监听 `127.0.0.1`，业务接口还检查本机 Host。
- `GEO_AUTH_MODE=invite`：必须配置至少32字符的高熵 `BETTER_AUTH_SECRET` 和明确的 `BETTER_AUTH_URL`。缺失、非法模式或非法地址返回待配置错误，不回退到本地工作区。非 loopback 地址必须使用 HTTPS。

邀请模式使用 Better Auth 1.7.14 和 PostgreSQL Drizzle adapter。登录、密码校验、会话 cookie 和退出均由 Better Auth 处理。原始开放注册入口被关闭；公开认证路由只允许登录、退出和读取会话。

## 启用本机邀请模式

先安装依赖、启动数据库并应用全部迁移：

```powershell
npm run db:migrate
npm run auth:configure -- --url http://127.0.0.1:3000
```

第二个命令更新被 Git 忽略的 `.env.local`，启用邀请模式并生成高熵密钥；已有有效密钥会保留，不打印密钥。重启应用后生效。恢复研发预览时将本地文件中的 `GEO_AUTH_MODE` 改为 `local` 后重启；不要将这种无登录模式用于对外部署。

## 签发邀请

操作员在本机通过 CLI 签发：

```powershell
npm run auth:invite -- --email person@example.com --workspace-name 企业工作区
```

默认创建新的空工作区。数据库只保存邀请凭证的 SHA-256 哈希、绑定邮箱、目标工作区、过期和使用记录。凭证由48字节强随机数生成，默认72小时有效，可用 `--expires-hours` 设置1至168小时。

原始邀请链接写入被忽略的 `.local/invitations/` 私有文件，终端仅输出文件位置与非凭证元信息。操作员通过受控方式向收件人交付链接。邀请凭证放在 `/login#invite=...` 的 URL 片段中，不作为请求 URL 查询参数发送给服务器；注册界面读取后清除地址栏片段。不要把私有文件、链接、密码或会话 cookie 写入工单和 Git。

收件人在 `/login` 填写绑定邮箱、姓名和至少12字符密码。接受邀请时在同一事务内锁定并消耗邀请、建立 Better Auth 账号和密码记录、建立工作区成员关系；随后使用 Better Auth 正常登录。无效、过期、已使用或邮箱不匹配的邀请不能创建账号，并发接受只允许一次成功。

## 接管已有本地资料

任意新账号不会自动取得 `local-workspace`。只有操作员明确指定已存在工作区，才能授予其访问权限：

```powershell
npm run auth:invite -- --email owner@example.com --workspace-id local-workspace
```

该操作不迁移或覆盖项目和历史版本。请先确认收件人对这些资料有权访问。当前每个账号只有一个工作区，已建立账号的邮箱不能通过再次注册自行切换或接管其他工作区；复杂成员管理留待后续需求。

## 服务端授权与接口契约

全部业务 HTTP 接口必须 `await getLocalContext()`，由真实 Better Auth 会话和数据库成员关系确定 `workspaceId`、`actorId`，再显式传给仓储。请求体、查询参数和自定义 header 都不能选择另一工作区。后续新增采样、队列、费用、证据和导出入口也必须使用同一授权边界。

`GET /api/session` 返回：

```json
{
  "mode": "invite",
  "user": null,
  "workspace": null,
  "needsLogin": true
}
```

登录后 `user` 含 `id/name/email`，`workspace` 含 `id/name`；未登录业务请求返回401，没有成员关系的账号返回403，跨工作区资源按不存在返回404。缺少邀请模式配置返回503及可理解的待配置错误。会话响应不缓存。

登录页面为 `/login`；工作台可复用 `AuthStatus`，通过 `onBeforeSignOut` 在退出前检查未保存草稿。Cookie 为 HttpOnly、SameSite=Lax，HTTPS 配置下启用 Secure；本机 HTTP 验证不会伪称已验证真实 HTTPS 部署。

## 本轮实际验证边界

- 使用本机合成账号实际接受邀请、Better Auth 登录与退出，验证匿名业务访问401、原始开放注册403、真实会话成员映射、跨工作区项目列表/详情/修改/版本隔离。
- 实际验证邀请重放、错误邮箱、过期拒绝、并发接受只成功一次，以及客户端伪造工作区参数不能越权。
- 已存在的问题版本和页面接口同步使用同一会话解析器；新增资源仍须逐项做实际隔离验证。
- 尚未实现的采样队列、费用、最终报告下载等资源不在本轮“已实测”范围，须在各自实现及最终对外验收时继续核对。
- 所有验收账号与资料均为合成内容，不构成真实企业或消费端通道验收。

官方依据：[Better Auth 安装](https://better-auth.com/docs/installation)、[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)、[Next.js 集成](https://better-auth.com/docs/integrations/next)、[邮箱密码认证](https://better-auth.com/docs/authentication/email-password)。

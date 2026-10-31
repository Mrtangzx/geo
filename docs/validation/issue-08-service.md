# Issue #8：页面检查服务层验证记录

日期：2026-10-31。关联任务：[GEO MVP #8](https://github.com/Mrtangzx/geo/issues/8)。

本文记录直接调用页面抓取与诊断服务所得的结果。地址判断、robots 匹配和公开网页冒烟通过临时 CLI 执行；常规功能未新增测试代码。对本次发现的 robots 通配符潜在同步回溯 bug，按用户规则与根代理明确要求新增三项针对性回归。

## 验证边界

- 已验证：纯地址安全判断、robots 路径匹配、一次真实公开 HTML 页面与 robots 抓取，以及真实 robots 禁止、DNS 失败和网络超时的状态表达。
- 已完成所辖文件的 ESLint 检查；后端类型检查未发现自身类型错误。全项目构建、HTTP 接口、数据库持久化、工作区授权及浏览器完整操作由集成验收另行记录，不能由本记录代替。
- 实际公开页面响应会变化，下列字节数、地址和哈希仅代表本次观察，不是固定标准答案或服务质量承诺。
- 页面原始响应与提取正文作为不可信证据保留，不执行页面脚本或其中的操作指令。访问成功、robots 允许及未观察到 noindex 均不能证明任何目标 AI 平台已抓取或收录。

## 纯地址安全判断

调用 `isPublicPageAddress` 检查 32 个地址。29 个拒绝、3 个允许，结果符合预期。此组仅运行地址判断，向内网、保留、链路本地或云内部目标发起的网页请求数为 **0**。

| 类型 | 拒绝样本 |
|---|---|
| 未指定、回环、私网 | `0.0.0.0`、`127.0.0.1`、`10.0.0.1`、`172.16.0.1`、`192.168.1.1` |
| 云内部及链路本地 | `169.254.169.254`、`100.100.100.200`、`168.63.129.16`、`192.0.0.192` |
| 文档、基准、保留及组播 | `192.0.2.1`、`198.18.0.1`、`198.51.100.1`、`203.0.113.1`、`224.0.0.1`、`240.0.0.1`、`255.255.255.255` |
| IPv6 本地及映射 | `::`、`::1`、`::ffff:127.0.0.1`、`::ffff:8.8.8.8`、`64:ff9b::a00:1`、`fe80::1`、`fc00::1` |
| IPv6 文档、特殊及隧道 | `2001:db8::1`、`2001:20::1`、`2002:7f00:1::`、`3fff::1`、`3fff:fff::1`、`ff02::1` |

允许样本：`8.8.8.8`、`1.1.1.1`、`2606:4700:4700::1111`。允许表示地址分类可作为公共目标候选，不代表已实际连接该地址或其页面可用。

## robots 规则匹配

四项基础匹配结果均符合预期：

| 规则与路径 | 观察结果 |
|---|---|
| 通配用户代理 `Disallow: /`，路径 `/product` | disallowed |
| `Disallow: /private`、`Allow: /private/public`，路径 `/private/public` | allowed，较长 Allow 匹配 |
| 仅 GPTBot 组禁止，检查代理为 GEOReviewBot | allowed，不把特定代理规则扩大成所有代理 |
| `Disallow: /*.pdf$`，路径 `/report.pdf` | disallowed |

另核对六项通配符和结束锚点组合，均符合预期。匹配采用有序字面片段，不把不可信规则构造成正则表达式；含 5,000 个通配片段的临时对抗输入在本次约 0.55 ms 返回，此测量只用于发现明显回溯问题，不是性能验收指标。

修复范围为 `page-diagnostics.ts` 的通配路径匹配，未跳过 robots 规则。专门回归文件 `src/server/page-diagnostics.test.ts` 包含路径/结束锚点、最长匹配/Allow 同优先级，以及真实回溯形状的 CPU 边界三项检查。运行 `npx tsx --test src/server/page-diagnostics.test.ts`，结果 3/3 通过；所辖 ESLint 通过。

对抗子进程使用 32 个 `*a` 片段、300 个 `a` 且缺少结尾 `b` 的路径，同时确认补上结尾后确实禁止访问，防止以不解析规则来获得通过。计算部分须在 1 秒内完成，子进程设 10 秒硬超时，避免同事件循环的超时无法中断旧式同步正则。该例未发起网络请求。

## 真实公开网页

### Node.js 正常 HTML 页面

目标：[https://nodejs.org/en](https://nodejs.org/en)。直接调用 `capturePublicPage` 的本次结果：

- 状态 `success`，HTTP `200`，接收 `530380` 字节，`bodyReadable=readable`，无错误。
- 标题为 `Node.js — Run JavaScript Everywhere`，已提取可读正文；原始响应保留在 `rawBody`，正文提取不会执行脚本。
- robots 状态 `available`，对当前检查代理 GEOReviewBot 的路径判断为 `allowed`。
- A 与 AAAA 返回的四个地址均经公共地址校验：`104.16.213.131`、`104.16.212.131`、`2606:4700::6810:d583`、`2606:4700::6810:d483`。连接使用已校验地址的固定 lookup，不在校验后交回默认 DNS 再解析。
- 没有重定向；本次未观察到通用 noindex。
- 响应正文 SHA-256：`82a1b32f3816beeba2af1860efa5852322c874a06d62109776bcac48fe2cfb38`。

### 百度 robots 禁止

目标：[https://www.baidu.com/](https://www.baidu.com/)。robots 实际返回并被解析，`robots.status=available`、`crawlerAccess=disallowed`。

页面检查返回 `blocked` 和 `ROBOTS_DISALLOWED`。未读取业务页面，HTTP 状态、标题与业务正文保持未知；没有把 robots 禁止或未读取内容当作正常空页面。

### example.com DNS 失败

目标：[https://example.com/](https://example.com/)。本机默认解析环境中，A 与 AAAA 查询均超时，OS lookup 返回 ENOTFOUND；同机其他公开域名可正常返回 A 和 AAAA，因此没有修改系统 DNS、Clash 或放宽目标地址检查。

服务返回 `failed`、`DNS_UNVERIFIED`，HTTP 状态及正文未知，`bodyComplete=false`。robots 为 `unavailable`，规则保持未知，不输出访问正常或已收录结论。

另对公开 IP 网页 `https://1.1.1.1/` 的连接尝试触发总时限，返回 `FETCH_TIMEOUT_OR_CANCELLED`，正文仍为未知；此结果不与地址分类允许混为一谈。

## 代码约束与尚待集成验证

- 静态核对：仅 HTTP(S) 标准端口、无 URL 凭证；每次解析和每一跳都校验全部返回地址；固定已校验地址建立连接，并核对实际远端地址。
- 静态核对：最多 10 个选定页面，每页最多 3 次重定向；页面正文 1 MiB、robots 128 KiB、响应头 16 KiB、总时限 25 秒。请求只接受 identity，返回压缩内容时拒绝正文读取，不进行不受限解压。
- 静态核对：项目内检查使用数据库短租约避免并发，外部请求期间不持有数据库事务或连接；已完成快照不覆盖，未完成记录保留未知状态，后续重试生成新修订。
- 尚未通过本记录验证：HTTP 路由、跨工作区访问、数据库复查与历史版本、配置冲突、重启中断、恶意重定向、超大响应与压缩输入的端到端故障注入，以及浏览器快照查看。由根代理按实际覆盖范围补充记录。

实现依据：[Node.js HTTP 自定义 lookup](https://nodejs.org/api/http.html)、[Node.js DNS Resolver](https://nodejs.org/api/dns.html)、[OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)、[ipaddr.js](https://github.com/whitequark/ipaddr.js)。

# Issue tracker: GitHub

仓库：https://github.com/Mrtangzx/geo
任务和规格使用 GitHub Issues，通过 gh CLI 操作。

## 操作约定

- 操作前确认目标仓库为 Mrtangzx/geo。
- 发布任务：创建独立 GitHub Issue。
- 读取任务：读取完整正文、标签及评论。
- 多行正文使用临时文件和 --body-file，保留真实换行。
- 阻塞关系优先使用 GitHub 原生 issue dependencies。
- 原生依赖不可用时，在正文中列出 Blocked by: #编号。
- 所有阻塞任务关闭后，该任务才可开始。
- 来源是已有 Issue 时，将拆出的任务关联为其子任务。
- 评论、状态及处理结论保留在对应 Issue 中。

## Pull requests as a triage surface

PRs as a request surface: no.

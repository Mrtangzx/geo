# Issue #2：问题集服务层验收

日期：2026-10-31。范围为真实 PostgreSQL 17 中的问题集服务与服务端入参校验，不包含 HTTP、浏览器、消费端通道、模型调用或真实企业效果验收。

## 环境与资料

- 已应用统一迁移 `0001_deep_spirit`，实际读取与写入 `question_sets`、`question_set_versions`。
- 独立项目：`问题集服务验收（合成）`，ID `9fcab3a7-1bb1-4caa-a134-c2d69be1f612`，工作区 `local-workspace`，`isSynthetic=true`。
- 未操作根代理浏览器项目 `澄岳数析（研发验收）`。
- 输入来自 `test-materials/geo-r2/inputs/questions.csv` 的 10 条合成问题，未将夹具中的虚构确认者当作真实用户授权。
- 临时执行脚本及结果保存在系统临时目录 `codex-geo-issue-02`；未新增持久化测试代码，没有输出连接凭证。

显式映射：行业发现/方案比较/品牌核实分别为 `industry_discovery` / `solution_comparison` / `brand_verification`；P0/P1/P2 分别为 `high` / `normal` / `low`；来源说明保持原文，销售咨询、客户 FAQ、搜索词分别归到对应来源类型；`is_focus` 转为布尔值。

## 实际结果

| 场景 | 结果 |
|---|---|
| 首次读取 | revision 0、draft、0 个已保存问题 |
| 草稿前请求正式采样输入 | 404 `CONFIRMED_QUESTION_VERSION_NOT_FOUND` |
| 保存 10 题草稿 | revision 1，10 个唯一稳定问题 ID |
| 明确确认 | 冻结 V1，10 题，状态 confirmed |
| 导出 V1 采样输入 | 每题文本与原始夹具逐字一致，无额外品牌或项目资料字段 |
| 修改已有问题并增加 1 条补充建议 | 新草稿，V1 的完整结构快照保持不变 |
| 模型来源未知 | 补充建议明确说明为合成演练手工提供，来源模型保存为 null，没有执行模型调用 |
| 重复文本确认 | 服务端确认校验拒绝，等价接口状态 400 |
| 空来源确认 | 服务端确认校验拒绝，等价接口状态 400 |
| 21 题输入 | `saveQuestionSetSchema.safeParse` 返回失败，不进入数据库写入；HTTP 状态另由根代理验收 |
| 同 revision 并发保存两次 | 恰好 1 次成功、1 次 409 |
| 再次明确确认 | 冻结 V2，11 题；V1 仍为原始 10 题 |
| 过期 revision 保存 | 409 `QUESTION_VERSION_CONFLICT` |
| 过期 revision 确认 | 409 `QUESTION_VERSION_CONFLICT` |
| 已确认状态重复确认 | 409 `QUESTION_SET_ALREADY_CONFIRMED`，未追加新版本 |
| 另一工作区读取问题 | 404 `PROJECT_NOT_FOUND` |
| 另一工作区读取采样输入 | 404 `PROJECT_NOT_FOUND` |
| 另一工作区写入问题 | 404 `PROJECT_NOT_FOUND` |
| 外来问题 ID 写入当前草稿 | 400 `QUESTION_NOT_FOUND` |
| 所有拒绝场景后回读 | 仍只有 V1、V2，V1 结构未变，当前 revision 8、confirmed |

共执行 21 项检查，全部得到预期结果。问题历史使用结构比较核对，因为 PostgreSQL JSONB 不承诺对象键的序列化顺序。

## 验证边界与保留记录

- 服务抛出的状态不等于已经验证 HTTP 返回码；接口身份鉴别、HTTP 状态、浏览器交互及导出下载由根代理另行验收。
- 另有首次临时比较中断的合成项目 `89546fa5-faa3-40e1-a9b6-0abed68a93c7`，保留在 revision 3、draft。中断原因是比较脚本使用 JSON 字符串键序判断；改用结构比较后得到上述结果，未因此修改平台源码。
- 本记录只证明问题集与版本流程，不证明已获得真实买家问题、消费端通道通过、发生真实付费或产生优化效果。

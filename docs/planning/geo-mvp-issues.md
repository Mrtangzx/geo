# GEO MVP 任务索引

更新日期：2026-10-31。

基于用户确认的 R2 开发计划与 23 项任务拆分，任务已发布到 [Mrtangzx/geo 的 GitHub Issues](https://github.com/Mrtangzx/geo/issues)。GitHub Issue 正文与原生阻塞关系是任务执行依据，本文件仅提供索引。

- 共 23 张任务票、154 条验收条件、36 条原生阻塞关系，已回读核对正文、标签、状态和完整依赖。
- #1 已通过本机工程验收，其余任务依照 GitHub 实际状态推进；`ready-for-agent` 表示规格已就绪，执行前仍须检查阻塞任务是否全部关闭。
- #1 完成后可并行开始：[#2](https://github.com/Mrtangzx/geo/issues/2) 问题集、[#8](https://github.com/Mrtangzx/geo/issues/8) 页面诊断、[#16](https://github.com/Mrtangzx/geo/issues/16) 邀请登录。
- 任务发布不代表业务实现或真实效果验收已完成；第 15 项的真实日期观察不阻塞独立的 SaaS 功能建设。

| 序号 | GitHub 任务 | 阻塞任务 |
|---|---|---|
| 01 | [#1 本地品牌资料与企业事实管理](https://github.com/Mrtangzx/geo/issues/1) | 无，可立即开始 |
| 02 | [#2 真实买家问题集确认与版本管理](https://github.com/Mrtangzx/geo/issues/2) | [#1](https://github.com/Mrtangzx/geo/issues/1) |
| 03 | [#3 国内单次采样与费用闭环](https://github.com/Mrtangzx/geo/issues/3) | [#2](https://github.com/Mrtangzx/geo/issues/2) |
| 04 | [#4 采样异常恢复与费用核对](https://github.com/Mrtangzx/geo/issues/4) | [#3](https://github.com/Mrtangzx/geo/issues/3) |
| 05 | [#5 国内消费端通道真实验收](https://github.com/Mrtangzx/geo/issues/5) | [#4](https://github.com/Mrtangzx/geo/issues/4) |
| 06 | [#6 有证据的推荐与企业事实分析](https://github.com/Mrtangzx/geo/issues/6) | [#4](https://github.com/Mrtangzx/geo/issues/4) |
| 07 | [#7 检查结果、指标追溯与人工纠正](https://github.com/Mrtangzx/geo/issues/7) | [#6](https://github.com/Mrtangzx/geo/issues/6) |
| 08 | [#8 公开页面访问诊断与快照](https://github.com/Mrtangzx/geo/issues/8) | [#1](https://github.com/Mrtangzx/geo/issues/1) |
| 09 | [#9 从诊断生成具体修改建议](https://github.com/Mrtangzx/geo/issues/9) | [#6](https://github.com/Mrtangzx/geo/issues/6)、[#8](https://github.com/Mrtangzx/geo/issues/8) |
| 10 | [#10 修改任务审核与版本流转](https://github.com/Mrtangzx/geo/issues/10) | [#9](https://github.com/Mrtangzx/geo/issues/9) |
| 11 | [#11 自有内容上线核验](https://github.com/Mrtangzx/geo/issues/11) | [#10](https://github.com/Mrtangzx/geo/issues/10) |
| 12 | [#12 技术修复、第三方修改与人工核验](https://github.com/Mrtangzx/geo/issues/12) | [#10](https://github.com/Mrtangzx/geo/issues/10) |
| 13 | [#13 冻结基线与周期监测](https://github.com/Mrtangzx/geo/issues/13) | [#4](https://github.com/Mrtangzx/geo/issues/4)、[#8](https://github.com/Mrtangzx/geo/issues/8) |
| 14 | [#14 上线复查与可比变化报告](https://github.com/Mrtangzx/geo/issues/14) | [#7](https://github.com/Mrtangzx/geo/issues/7)、[#11](https://github.com/Mrtangzx/geo/issues/11)、[#13](https://github.com/Mrtangzx/geo/issues/13) |
| 15 | [#15 首家真实企业完整案例验收](https://github.com/Mrtangzx/geo/issues/15) | [#5](https://github.com/Mrtangzx/geo/issues/5)、[#14](https://github.com/Mrtangzx/geo/issues/14) |
| 16 | [#16 邀请登录与工作区隔离](https://github.com/Mrtangzx/geo/issues/16) | [#1](https://github.com/Mrtangzx/geo/issues/1) |
| 17 | [#17 客户自助建项目与额度管理](https://github.com/Mrtangzx/geo/issues/17) | [#2](https://github.com/Mrtangzx/geo/issues/2)、[#4](https://github.com/Mrtangzx/geo/issues/4)、[#16](https://github.com/Mrtangzx/geo/issues/16) |
| 18 | [#18 带权限和版本依据的报告导出](https://github.com/Mrtangzx/geo/issues/18) | [#14](https://github.com/Mrtangzx/geo/issues/14)、[#16](https://github.com/Mrtangzx/geo/issues/16) |
| 19 | [#19 海外 ChatGPT 网页采样](https://github.com/Mrtangzx/geo/issues/19) | [#4](https://github.com/Mrtangzx/geo/issues/4) |
| 20 | [#20 千问联网 API 独立对照](https://github.com/Mrtangzx/geo/issues/20) | [#7](https://github.com/Mrtangzx/geo/issues/7) |
| 21 | [#21 人工证据导入](https://github.com/Mrtangzx/geo/issues/21) | [#7](https://github.com/Mrtangzx/geo/issues/7) |
| 22 | [#22 Docker 内测交付与对外安全验收](https://github.com/Mrtangzx/geo/issues/22) | [#12](https://github.com/Mrtangzx/geo/issues/12)、[#17](https://github.com/Mrtangzx/geo/issues/17)、[#18](https://github.com/Mrtangzx/geo/issues/18)、[#19](https://github.com/Mrtangzx/geo/issues/19)、[#20](https://github.com/Mrtangzx/geo/issues/20)、[#21](https://github.com/Mrtangzx/geo/issues/21) |
| 23 | [#23 三至五家邀请试点与产品评估](https://github.com/Mrtangzx/geo/issues/23) | [#5](https://github.com/Mrtangzx/geo/issues/5)、[#22](https://github.com/Mrtangzx/geo/issues/22) |

## 执行约定

- 每票按其验收条件完成适用检查、浏览器验收与人工核对，记录真实验证范围，并创建对应 Git commit。
- 需要账号、密钥、额度、真实企业资料或实际日期的验收项，缺少前提时保留具体状态，不以演示数据代替。
- 通道验收、工程流程完成与真实优化效果分别记录，失败、缺失和未知不得记为零或成功。
- 暂缓在线支付、自动发稿、全平台覆盖、复杂权限及大屏，后续扩展以真实试点记录为依据。

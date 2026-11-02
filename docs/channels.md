# 外部通道契约与接入边界

更新：2026-11-02。对应 #6、#19、#20。当前完成请求构造、响应解析和配置检查；尚未接入真实网络执行、持久化任务、预算结算或产品入口，不能据此关闭工单。当前按用户“先用合成材料”运行，真实付费请求为0。

## 官方接口核对

- DataForSEO 当前 ChatGPT 路径为 `/v3/ai_optimization/chat_gpt/llm_scraper/task_post` 与 `/task_get/advanced/{id}`。POST 按任务收费，后续结果查询免费且保存30天；请求使用语言、位置和原问题。参见[任务提交](https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_post/)、[结果查询](https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/task_get/advanced/)。
- `20100` 表示创建成功；`40601/40602` 仍在处理。错误或缺失费用不证明未受理、免扣费。参见[官方状态码](https://docs.dataforseo.com/v3/appendix/errors/)。
- DataForSEO 的使用限制仍需结合本产品用途、账号协议和数据保存方式核对，不能把一般文档阅读当作已取得商用授权。参见[使用条款](https://dataforseo.com/terms-of-service)。
- 百炼原生 HTTP 路径为 `https://{WorkspaceId}.{region}.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation`；搜索来源和引用角标选项使用原生 DashScope 参数。参见[原生接口](https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope)、[联网搜索](https://help.aliyun.com/zh/model-studio/web-search)。
- 分析默认请求 `qwen3.7-plus`，不启用搜索或工具。当前账户模型可用性、结构化输出兼容性和真实费用未验证。参见[模型说明](https://help.aliyun.com/zh/model-studio/qwen3-7-plus)。不写死此页面价格作为运行授权。

## 代码入口

- `src/lib/channel-contracts.ts`：来源、回答、受理/查询结果及持久提交意图契约。
- `src/server/channels/config.ts`：只暴露配置状态，凭证在独立私有函数中读取。百炼地址由合法业务空间和固定地域枚举构造，不允许客户端任意代理地址。
- `dataforseo.ts`：一次一题、普通优先级、固定官方主机、原问题编码；保留 `%` 和 `+` 字符。查询响应必须对应原任务ID。
- `dashscope.ts`：联网 API 与离线分析各自构造请求，记录请求模型和实际返回字段；未返回模型时保持未知，不用请求值补写。
- 这些模块没有 `fetch`，不会因配置检查、页面读取或契约验证产生网络调用。

## 环境配置契约

配置在服务端环境文件中维护，不通过浏览器写密钥，不提交版本库。下列价格或条款引用只填写无密钥的说明/记录位置。

| 范围 | 配置名称 |
|---|---|
| 总开关 | `GEO_EXTERNAL_PAID_CALLS_ENABLED`，默认关闭；开启也不能跳过数据库预算与提交意图 |
| DataForSEO | `DATAFORSEO_LOGIN`、`DATAFORSEO_PASSWORD`、`GEO_DATAFORSEO_TERMS_REFERENCE`、`GEO_DATAFORSEO_PRICE_REFERENCE`、`GEO_DATAFORSEO_UPPER_BOUND_USD_MINOR` |
| 百炼共同配置 | `DASHSCOPE_API_KEY`、`DASHSCOPE_WORKSPACE_ID`、`DASHSCOPE_REGION` |
| 千问联网 API | `GEO_QWEN_SEARCH_MODEL`（默认qwen3.7-plus）、`GEO_QWEN_SEARCH_PRICE_REFERENCE`、`GEO_QWEN_SEARCH_UPPER_BOUND_CNY_MINOR` |
| 不联网分析 | `GEO_ANALYSIS_MODEL`（默认qwen3.7-plus）、`GEO_ANALYSIS_PRICE_REFERENCE`、`GEO_ANALYSIS_UPPER_BOUND_CNY_MINOR` |

`*_MINOR` 是正整数分；缺少可靠上限保持待配置，不能按0元调用。已有真实额度仍默认0。配置齐全只表示配置存在，`acceptance` 始终为 `not_verified`，不代表账号、搜索或通道已实测。

## 数据语义

DataForSEO 归入 `consumer_web/dataforseo_chatgpt_web/chatgpt/web`；千问联网归入 `api_comparison/qwen_search_api/qwen/api`；分析模型单列 `analysis_model`。地区、语言、模型和搜索的实际返回字段与请求意图区分。百炼部署地域不冒充终端产品地区。

供应商 `sources`、`search_results` 或编号列表不等于完整正文片段映射。当前解析保留候选来源，正文引用为 `unknown/null`；不能因为来源含官网计为官网正文引用，也不能把未知显示成无引用。待取得可核对的片段映射后，另行形成引用审核版本。

DataForSEO 使用供应商采集时间；百炼同步请求记录响应接收时间并标记 `response_receipt`，不冒充供应商提供的时间。完整原始 JSON 应存入当前工作区私有证据记录；不得保存 Authorization 头或将原始驱动错误写日志。

## 后续接入持久任务与预算

1. 先冻结资料、已确认问题、通道配置和价格依据。逐题业务唯一键包含工作区、项目、问题/资料版本、日期、通道、地区、语言、搜索和模型；不包含基线/手动/复查用途。同题复用执行单元，多用途关联；显式新批次单独确认新增费用。
2. 在真实CNY/USD账户原子预留可靠费用上限，保存不可变价格依据和请求指纹。默认0额度直接停止；不从模拟账户扣真实费用。
3. 数据库原子地从 `reserved` 转为 `submission_intent` 后，才能发一次POST。普通重启和并发不得再次取得提交资格。
4. 已知DataForSEO任务仅GET原ID，保存原POST费用；查询费用0不能覆盖原提交账单。请求丢失、超时、服务端错误或缺账单保持待核对，不释放未知预留、不自动重新POST。
5. 百炼同步接口没有在本轮文档中核实可按客户端执行ID恢复结果的查询流程；响应不明需人工核对，不能伪造异步任务ID或自动重试。
6. 有可信账单/usage与冻结价格才能结算；未知或超过上限保留待核对。小于一分的供应商原始金额原样保存，整数分预算需明确向上预留/结算规则，不按四舍五入降成免费。
7. 回答结果与费用状态分别记录；成功回答费用待核对时原文仍可读，失败/截断/缺时间不得计入有效覆盖。真正已受理任务即使项目暂停仍查询与计账。

尚需实现对应PG执行表/事件、worker注册、预算账单衔接、权限API与独立入口。随后用真实账号和明确预算小批量验收；DataForSEO三实际日期、至少30计划样本、有效率和人工抽查仍未验证。

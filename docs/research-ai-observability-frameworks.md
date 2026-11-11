# PicAgent AI 可观测性框架调研

日期：2026-09-01

## 结论先行

建议 PicAgent 采用 **Langfuse 作为 AI 观测与 Prompt 运营层，OpenTelemetry 作为链路标准，Prometheus/Grafana（或现有基础设施）作为服务级 Metrics 层**。

第一阶段不要引入 AI Gateway，也不要把所有输入原文无条件上传。当前项目已经在服务端直接调用 DashScope LLM、OpenAI-compatible 图像 Provider，并且已有模型请求归档；最小改造是给现有工作流、tool、LLM 请求和图像请求增加结构化 observation/span。

## 项目现状与选择约束

- 技术栈是 React 19 + TypeScript/Vite，服务端是 Node.js/tsx。
- LLM 通过自定义 `fetch` 调用 DashScope-compatible `chat/completions`。
- 图像通过自定义 `fetch` + `multipart/form-data` 调用 OpenAI-compatible `/v1/images/edits`。
- 现有 Provider 已有 `requestId`、模型、提示词、输入图、响应摘要和失败归档，适合把该 ID 作为 telemetry 的业务关联键。
- 生成流程是异步任务；必须保证观测系统不可用时不阻塞生图和计划流程。
- 商品事实、提示词和图片属于敏感业务数据，默认只记录版本 ID、哈希、长度和摘要；原文/图片应做采样或显式开关。

对应代码：[`server/providers/dashscope-llm-client.ts`](../server/providers/dashscope-llm-client.ts)、[`server/providers/gpt-image-provider.ts`](../server/providers/gpt-image-provider.ts)、[`server/app.ts`](../server/app.ts)。

## 候选比较

| 候选 | 定位 | Tool / Prompt / Token / 延迟 | Node/TS 适配 | 自托管与锁定 | 对 PicAgent 的判断 |
|---|---|---|---|---|---|
| [Langfuse](https://github.com/langfuse/langfuse) | AI-native 观测、Prompt、评估、指标平台 | 原生支持层级 trace、tool invocation、检索步骤、Prompt 管理、成本/延迟；JS SDK 支持手动 `span`、`tool`、`generation`，可更新 usage | 很好；`@langfuse/tracing` 适合现有自定义 fetch | 官方提供 Docker Compose/Helm/Terraform；官方页面标注 MIT、OTel native | **首选**。最少改造，且能覆盖自定义 Provider 与图像生成 |
| [Phoenix](https://github.com/Arize-ai/phoenix) + OpenInference | OTel/OpenInference AI tracing、评估和数据集平台 | 有 `LLM`、`CHAIN`、`AGENT`、`TOOL` 语义；TS SDK 提供 `withSpan`、`traceTool`、`traceAgent`、手动 span；token 需由 Provider 响应或手动设置 | 很好；`@arizeai/phoenix-otel`，ESM 可手动 instrumentation | 本地/自托管 collector 简单；需单独核对 Phoenix 版本和许可边界 | **强备选**。若团队更看重 OTel/OpenInference 可移植性，选它 |
| [OpenLLMetry-JS](https://github.com/traceloop/openllmetry-js) | 基于 OTel 的 LLM 仪表层 | 自动/手动捕获常见 LLM、Agent、Tool、检索调用；token/延迟遵循 OTel/OpenLLMetry 属性 | 好；Apache-2.0；但对本项目自定义 DashScope fetch 仍需手动 span | 不提供完整观测 UI，需接 Langfuse、Phoenix、Grafana、Datadog 等 | **作为仪表层可选**，不建议单独作为平台 |
| [Helicone](https://github.com/Helicone/helicone) | AI Gateway + 请求观测 + Prompt Playground | 网关能自动记录 OpenAI/Anthropic 等请求、成本、延迟、会话和 Prompt | 通过改 `baseURL` 很方便；自定义图像 multipart 和现有 provider 仍需验证 | 开源仓库；但官方集成资料目前出现“maintenance mode”信号，需谨慎评估 | **暂不选**。会改变请求路径，且与当前 provider 边界重复 |
| [LiteLLM](https://github.com/BerriAI/litellm) | 多模型路由/统一 API/成本与回调 | 回调可发 Langfuse、Helicone、Prometheus 等；更偏网关和路由，不是专门的 trace UI | 核心 Proxy/生态偏 Python；当前 Node 直连架构引入成本较高 | 适合作为统一模型网关，但会增加部署组件 | **不为观测单独引入**；未来需要路由、fallback、预算控制时再评估 |
| [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) + Collector + Prometheus/Tempo/Grafana | 通用 Metrics/Logs/Traces 底座 | 最灵活；可自定义 tool、LLM、图像 span 和指标；AI 语义需自行遵循 GenAI/OpenInference 约定 | 很好；与 Node 服务自然匹配 | 供应商锁定最低；但 UI、Prompt 管理、AI 成本分析需自行拼装 | **必须保留的标准底座**，但单独使用会重复建设 AI UI |
| [SigNoz](https://github.com/SigNoz/signoz) | OTel-native 一体化 Logs/Metrics/Traces/APM | 官方仓库与文档列出 LLM/AI observability、Prompts、Tool Calls、Tokens、Latency、Costs；可直接接 OTLP | 很好；Node 应用按 OTel SDK 接入 | Community 可自托管，ClickHouse 存储；比 Langfuse 更偏通用 APM | **基础设施型备选**。如果团队希望一套系统覆盖服务与 AI，再选它 |
| [AgentOps TS](https://github.com/AgentOps-AI/agentops-ts) | Agent 生命周期与工具调用观测 SDK | README 明确支持 LLM generation、token usage、function/tool calls、handoffs、custom events | 有 Node/TS SDK；对自定义图像 Provider 仍需手动事件 | 更像 SDK/云服务组合，需单独核对自托管能力 | **不作为主平台**，可用于 Agent 专项试验 |

### 资料中的关键事实

- Langfuse 官方文档将原生集成和手动 instrumentation 并列，JS/TS 支持 `startActiveObservation`、`startObservation`，观察类型可以是 `span`、`tool`、`generation`；示例也展示了 `usageDetails` 和嵌套关系。[Langfuse instrumentation](https://langfuse.com/docs/observability/sdk/instrumentation)
- Langfuse JS/TS SDK 在 2026 年 3 月重写为 v5；新集成应使用 scoped packages（从 `@langfuse/tracing` + `@langfuse/otel` 开始），不要按旧 v3 包名安装。[langfuse-js README](https://github.com/langfuse/langfuse-js)
- Langfuse 官方页面明确列出层级 trace、tool invocation、检索步骤、Prompt 管理、成本/延迟，并提供 Docker Compose、Helm、Terraform 自托管方式，页面标注 MIT 和 OTel native。[Langfuse](https://langfuse.com/)
- Phoenix 的 TypeScript SDK提供 `register()`、`withSpan`、`traceChain`、`traceAgent`、`traceTool` 等 helpers，并支持手动 instrumentation、batch export 和 shutdown flush。[Phoenix TypeScript SDK](https://arize.com/docs/phoenix/sdk-api-reference/typescript/overview)、[Phoenix setup](https://arize.com/docs/phoenix/tracing/how-to-tracing/setup-tracing/setup-using-phoenix-otel)
- OpenLLMetry-JS 是建立在 OpenTelemetry 之上的扩展，可连接 Datadog、Honeycomb 等后端，仓库标注 Apache-2.0。[GitHub README](https://github.com/traceloop/openllmetry-js)
- Helicone 仓库把自己定位为 AI Gateway + LLM Observability，并强调通过改 `baseURL` 一行接入；但 Langfuse 当前的 Helicone 集成页面写有 maintenance mode 提示，因此不应只根据仓库活跃度做选型。[Helicone GitHub](https://github.com/Helicone/helicone)、[Langfuse Helicone integration](https://langfuse.com/integrations/gateways/helicone)
- OpenTelemetry GenAI 语义约定已经迁移到独立的 semantic-conventions 仓库；应把它作为字段命名参考，不要把尚未稳定的属性当成 PicAgent 内部不可变契约。[OpenTelemetry migration note](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- SigNoz 官方仓库定位为 OpenTelemetry-native 平台，覆盖 logs、metrics、traces、alerts、dashboards，并单列 LLM/AI observability；官方 README 还列出 prompts、tool calls、tokens、latency 和 costs。[SigNoz GitHub](https://github.com/SigNoz/signoz)
- AgentOps 的 TypeScript 仓库 README 明确列出 agent lifecycle、LLM generation、token usage、function calls、handoffs 和 custom events；它更适合作为 Agent 事件 SDK，而不是 PicAgent 的完整图片观测后端。[AgentOps TS GitHub](https://github.com/AgentOps-AI/agentops-ts)

## 对 PicAgent 的推荐架构

```text
PicAgent API / async generation task
        |
        |  OTel context + Langfuse observations
        v
  Langfuse (AI trace / prompt / cost / human feedback)
        |
        +--> OTLP Collector --> Prometheus/Grafana (service metrics)
        |                    \-> Tempo/其他 trace backend（可选）
        +--> structured JSON logs --> 日志系统
```

Langfuse 不应成为业务数据库的替代品：方案、任务、版本、attempt、图片和提示词快照仍以 PicAgent PostgreSQL/MinIO 为准；Langfuse 只保存可检索的观测副本和关联 ID。

## 建议的 Trace / Span 模型

### Trace 根节点

- `suite.plan`
- `suite.category-prompt`
- `suite.generate`
- `reverse.prompt`
- `image.edit`

根节点属性：`request_id`、`flow`、`suite_id`、`plan_id`、`task_id`、`attempt_id`、`environment`、`app_version`。

### 子节点

- `tool`: RAG 查询、Prompt 模板读取、图片/底图读取、MinIO 写入、数据库持久化。
- `generation`: DashScope 计划/类别提示词/反推提示词调用。
- `image-generation`: 图像 Provider 调用；如后端只接受标准 observation type，可用 `generation` 加 `output_type=image` 和 `picagent.image.*` 自定义属性。
- `validation`: JSON 解析、Schema 校验、数量约束、生成结果图片校验。

### 每次模型调用至少记录

- Prompt：`template_id`、`template_version_id`、`prompt_hash`、system/user 字符数、动态字段名；默认不上传完整商品事实和 base64 图片。
- Provider：`provider`、`model`、endpoint 名称、HTTP 状态、provider request ID（若有）。
- 时间：总耗时、provider 耗时、超时、重试次数；流式模型另加 TTFT。
- Token：只有 Provider 返回 usage 时记录 `input_tokens`、`output_tokens`、`total_tokens`、缓存/推理 token；没有返回就记 `null`，不要估算后冒充计费事实。
- 图像：输入图片数量、输出数量、尺寸、质量、响应字节数、mime、生成结果版本、Provider 计费单位/费用（若能取得）。图像生图的“消耗”通常不是文本 token，应单独建模。
- 错误：PicAgent 规范化错误码、HTTP 状态、可重试性和最终 attempt 状态。

## Metrics 设计

低基数指标放 Prometheus/OTel Metrics；高基数业务字段放 trace attributes，不要把 `prompt_hash`、`task_id`、`request_id` 放到 Prometheus label。

建议首批指标：

- `picagent_model_requests_total{flow,provider,model,status}`
- `picagent_model_request_duration_ms{flow,provider,model}`（p50/p95/p99）
- `picagent_model_errors_total{flow,provider,model,error_code}`
- `picagent_model_input_tokens_total{provider,model}`
- `picagent_model_output_tokens_total{provider,model}`
- `picagent_image_requests_total{flow,provider,model,status}`
- `picagent_image_request_duration_ms{flow,provider,model}`
- `picagent_image_input_count_total{provider,model}`
- `picagent_generation_attempts_total{flow,status}`
- `picagent_generation_queue_age_ms`（若后续有持久化队列）

首批告警：Provider p95 延迟、5xx/timeout 比例、无效 JSON 比例、无效图片比例、单日模型费用或图片计费单位异常。

## 实施顺序（不改变业务语义）

1. **观测契约**：先定义字段、脱敏、采样和错误隔离；验证方式是契约测试能检查一次 LLM 和一次图像调用生成完整 span。
2. **SDK 初始化**：在 API 进程最早位置初始化 Langfuse/OTel；提供 `OBSERVABILITY_ENABLED=false` 开关。验证方式是关闭后业务测试结果不变。
3. **Provider 包装**：只改 `DashScopeLlmClient` 和 `GptImageProvider`；每次调用用 `try/finally` 结束 observation，捕获 usage、HTTP 状态、耗时和错误。验证方式是 fake provider 的成功、超时、非 2xx、解析失败四类测试。
4. **工作流与 tool**：在 `app.ts` 的计划、类别提示词、反推、生图任务根部建立 trace；给 RAG、模板读取、对象存储、持久化加 tool/span。验证方式是 Langfuse UI 中能从 attempt 反查完整链路。
5. **服务指标与日志**：增加低基数 Metrics 和结构化 JSON 日志；trace 中只放关联 ID。验证方式是 `/metrics` 或 OTLP 接收端出现计数、延迟和错误分布。
6. **数据保留与成本**：配置采样、保留期和 payload 禁止列表；生产默认不记录 base64 图片、API key、完整商品资料。验证方式是脱敏测试和日志/trace 内容扫描。

## 最终建议

**V1 选 Langfuse + OTel 语义，先自托管；Prometheus/Grafana 只承担服务级 SLO。**

不要先上 Helicone/LiteLLM Gateway，也不要把 OpenLLMetry-JS 单独当作平台。若后续需要把观测后端从 Langfuse 换成 Phoenix、Grafana 或商业 APM，保持 OTel context、低基数 Metrics 和上述内部字段不变即可迁移。

## 主要来源

- Langfuse: <https://github.com/langfuse/langfuse>, <https://langfuse.com/docs/observability/sdk/instrumentation>, <https://langfuse.com/>
- Phoenix: <https://github.com/Arize-ai/phoenix>, <https://arize.com/docs/phoenix/sdk-api-reference/typescript/overview>, <https://arize.com/docs/phoenix/tracing/how-to-tracing/setup-tracing/setup-using-phoenix-otel>
- OpenLLMetry-JS: <https://github.com/traceloop/openllmetry-js>
- Helicone: <https://github.com/Helicone/helicone>, <https://langfuse.com/integrations/gateways/helicone>
- LiteLLM: <https://github.com/BerriAI/litellm>
- OpenTelemetry JS: <https://github.com/open-telemetry/opentelemetry-js>
- OpenTelemetry GenAI semantic conventions: <https://github.com/open-telemetry/semantic-conventions/tree/main/docs/gen-ai>

## 补充候选：OpenLIT 与 Opik

### OpenLIT

- **定位**：Apache-2.0、OpenTelemetry-native 的 LLM/Agent observability 平台，提供 traces、metrics、logs、exceptions，并可把数据发送到 OTLP Collector、Prometheus/Tempo、Grafana、SigNoz 等后端。
- **TypeScript**：官方 TypeScript SDK支持 Node.js 初始化和 OTel 导出；README 明确列出 usage tokens、请求数、操作耗时、TTFT/TBT 与 cost 指标。对 PicAgent 的自定义 `fetch`，仍需手动创建 span 或确认具体 provider instrumentation。
- **图像生成**：OpenLIT 官方 OpenAI Python instrumentation 源码已明确包装 `image_generate`、`image_edit`、`image_variations`，并进入图像响应处理和 cost/时延记录路径；这不能直接证明 TypeScript 图片 endpoint 已覆盖，必须针对当前 Node SDK 版本做 smoke test。
- **自托管/许可**：仓库提供 Docker Compose/Helm 路径，许可证为 Apache-2.0。
- **对 PicAgent 的判断**：如果目标是用一套 OTel 管道同时承载 Metrics、Logs、Traces，OpenLIT 比单独拼装多个 SDK 更合适；但 Prompt 模板快照、任务/资产血缘仍应留在 PicAgent 数据库，不应迁移到观测平台。

一手来源：

- <https://github.com/openlit/openlit>
- <https://github.com/openlit/openlit/blob/main/sdk/typescript/README.md>
- <https://github.com/openlit/openlit/blob/main/docs/latest/openlit/observability/telemetry/overview.mdx>
- <https://github.com/openlit/openlit/blob/main/sdk/python/src/openlit/instrumentation/openai/async_openai.py>

### Opik

- **定位**：Apache-2.0 的开源 LLM observability、evaluation 和 Agent tracing 平台；官方仓库声明完整后端与 Web UI 可自托管，支持多步 trace、LLM calls、tool executions、retrieval、token usage 和在线评估。
- **TypeScript**：官方集成列表包含 TypeScript SDK、OpenAI JS/TS、LangChain JS/TS、Gemini TypeScript、Mastra 与 OpenTelemetry，适合 PicAgent 的 Node 工作流和手动 tool span。
- **图像生成**：官方 README 没有把图片生成 endpoint 列为独立一等集成；对 OpenAI-compatible `/v1/images/*` 或第三方 provider，应先以自定义 span 记录图片参数、耗时、响应 request ID、计费信息，再验证是否能自动解析 usage。
- **自托管/许可**：仓库提供 Docker/Helm/Windows `opik.ps1` 启动与 `--verify` 健康检查，许可证为 Apache-2.0。
- **对 PicAgent 的判断**：如果后续重点转向 Agent 轨迹、在线评估和 Prompt 优化，Opik 是值得做对照试验的第二候选；当前不宜在未验证图片链路前替换 Langfuse。

一手来源：

- <https://github.com/comet-ml/opik>
- <https://github.com/comet-ml/opik/blob/main/README.md>

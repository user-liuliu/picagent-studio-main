---
status: accepted
---

# Langfuse 与 OpenTelemetry 观测边界

PicAgent 使用自托管 Langfuse 作为 AI 观测、Prompt 执行记录、Tool 调用、Token、成本、延迟和人工反馈平台，使用 OpenTelemetry 作为 Trace/Metric 标准；观测数据与 PicAgent PostgreSQL/MinIO 中的业务事实、任务、图片和不可变版本分离。测试服务器允许持续采集完整 Prompt 和文本输出，数据不主动删除；密钥、认证头、数据库密码、图片 base64 与原始图片二进制永不进入观测数据。观测系统不可用时不得阻塞模型调用和图片生产。

## Considered Options

- 只使用 Langfuse SDK：接入快，但会把业务代码绑定到单一观测供应商。
- 使用 OTel、Prometheus、Tempo、Grafana 自行拼装：可移植，但需要重复建设 AI Prompt、Token、成本和反馈界面。
- 使用 Helicone/LiteLLM Gateway：改变当前 Provider 直连边界，并为观测额外引入网关和路由复杂度。

## Consequences

- 现有 DashScope 和图像 Provider 通过内部观测适配层手动创建 generation/tool/span。
- Prompt 模板正文和版本事实源仍在 PicAgent；Langfuse 保存执行时的观测副本。
- 测试环境 Langfuse 数据无限期保留，后续如需清理必须另行制定运维策略。

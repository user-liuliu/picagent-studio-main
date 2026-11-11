# Ticket 05：生成简报与计划快照

状态：已实现并完成 PostgreSQL、真实 DashScope 与 1440×1000 桌面验收
日期：2026-08-23

## 已完成

- 新增 PG-backed validation Chunk、异步计划 attempt、不可变计划/Chunk 快照、计划项与人工修订版本。
- 计划模板仅使用 PG 已发布 `plan` v3，动态字段严格来自版本 `input_schema`；创建页不再依赖 `promptDemoInput` 或 `ragChunks` fixture。
- 自动填写只读取已勾选 Chunk 的结构化字段，只补空值；计划提交仅发送稳定 ID/版本，服务端重新读取并冻结正文。
- 新增 `RagClient`、`LlmClient`、真实 DashScope provider 和显式 deterministic fake 契约；未配置时返回 `LLM_NOT_CONFIGURED`。
- 计划 POST 立即返回 `202 + attemptId`，页面每秒从 PG 轮询；成功、失败与刷新均可恢复，启动时中断陈旧 running attempt。
- LLM 输出通过 `suite-plan-v1` Schema 后才创建计划；人工编辑追加 revision，不覆盖初始快照。
- “开始创作”只执行可用底图与最新计划前置校验，不触发 Ticket 06 图片生成。

## 验收证据

- 新增 Ticket 05 测试 7 项，既有契约测试 21 项全部通过；类型检查和生产构建通过。
- validation seed 连续执行两次均为 5 条，PG 最终为 5 个稳定 ID，无重复。
- PG 已发布模板保持 21 个 v3：`plan=16`、`base_refine=1`、`task_image=4`；16 个 plan `input_schema` 均非空。
- 真实 DashScope：provider `dashscope`，model `qwen3.7-flash-2026-07-15`，`isFake=false`，成功创建计划快照。
- Playwright：1440×1000，PG Chunk 搜索/勾选、自动填空、计划生成、人工修订版本 2、刷新恢复和开始创作前置校验通过；0 console errors/warnings，无横向溢出。
- 截图：`output/playwright/ticket05-plan-snapshot-1440x1000.png`。

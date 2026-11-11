# PicAgent 套图工作台 V1 技术规格

> 状态：待产品确认后进入实现
> 日期：2026-08-22
> 依据：`docs/PRD-套图工作台-V1.md`、`docs/原型基准说明.md`、`docs/gpt-image-2.md`

## 1. 目标与边界

本规格把已确认 PRD 转换为可拆分、可测试、可恢复的工程契约。首版是桌面端套图工作台独立项目，不复制旧 PicAgent 项目结构，不实现登录权限、数据中台、RAG 入库或其他图片模式。

实现假设：使用 TypeScript；前端和服务端同仓库；后台生成采用持久化任务记录加服务端 worker；PostgreSQL 和 MinIO 为服务器实例；浏览器只拿短期图片访问地址或代理响应。

## 2. 推荐项目结构

```text
pic_agent_suite_workbench/
  apps/
    web/                         # React + Vite 桌面工作台
      src/
        app/                     # 路由、Query/状态装配
        pages/                   # SuiteHome、CreationBoard、TaskRefine
        features/
          suite/                 # 方案、输入图、底图版本
          plan/                  # 模板、Chunk 选择、计划编辑
          task/                  # 卡片、版本、归档
        components/              # 纯展示组件
        api/                     # 类型化 HTTP client
    api/                         # HTTP API 与鉴权占位
      src/
        routes/                  # 仅做参数校验和响应编排
        services/                # suite/plan/generation 应用服务
        repositories/            # PostgreSQL 访问
        storage/                 # MinIO 访问
        providers/               # image、llm、rag 适配器
        jobs/                    # 生成任务消费者/重试调度
        schemas/                 # 请求、响应、计划 Schema
        config/                  # 环境变量读取与校验（不记录密钥）
    worker/                      # 可独立启动的异步任务进程
      src/jobs/                   # base、plan、batch、single generation
  packages/
    domain/                      # 状态、ID、业务规则、错误码
    contracts/                   # 前后端共享 DTO/Schema
    prompts/                     # 阶段模板渲染与快照类型
  db/
    migrations/                  # 严格编号、向前迁移
    seeds/                       # 仅开发模板假数据，不含生产资料
  tests/
    contract/                    # API schema
    integration/                 # PG/MinIO/provider fake
    browser/                     # 桌面浏览器验收
  docs/
    PRD-套图工作台-V1.md
    gpt-image-2.md
    TECH-SPEC-套图工作台-V1.md
  package.json
  pnpm-workspace.yaml
  .env.example                  # 变量名和说明，禁止真实值
```

初始实现可将 `worker` 与 `api` 放在同一 Node 进程中通过独立命令运行，但领域层、provider 和任务状态必须保持可拆分。

## 3. 前端方案与页面结构

### 3.1 技术方案

- React + TypeScript + Vite；TanStack Query 负责服务端状态和刷新恢复；Zod（或同等 Schema 库）校验 API DTO。
- 页面状态以 `suiteId` 为根，禁止仅依赖内存数组；所有可恢复状态来自 API。
- 上传使用分片/进度可插拔接口，V1 可先用 multipart 单请求；图片预览使用短期 URL。
- 桌面最小验收视口 1440x1000；不承诺移动布局。

### 3.2 原型基准（必须遵守）

正式页面以 `prototype/picagent-suite-start.html`、`prototype/picagent-suite-workbench.html` 及其 `prototype/assets/` 为结构和交互基准。原型中的静态数据、演示延迟和 fake 生成逻辑可以替换为真实 API，但不得未经确认删除、重排或改变以下核心区域和操作顺序：

- 创建首页：顶部品牌/上下文栏和侧边导航；“套图模式”模式条；“商品图对比”区域（原始实拍图、AI 自动精修、精修白底图）；“生成简报”区域（模板选择、动态字段、从资料自动填写、RAG 检索/勾选）；底部开始生成；最近项目。
- 创作工作台：顶部面包屑和“创作板/成品展示板”切换；左侧工作台导航；画布预览工具栏；画布中的原图节点、白底节点和套图卡片网格；右侧继续创作参数栏；卡片编辑、图片预览、删除确认和资源库弹窗。
- 原型保留的“接口预留”入口可以在 V1 显示，但点击后应给出明确的未实现提示，不得误调用其他模式。

视觉细节可随正式组件、真实数据和桌面可用性验证收敛，但必须保持上述工作台结构、信息层级、核心文案语义和操作顺序。若要改变页面结构或核心流程，先更新 PRD 与原型基准说明。

### 3.3 页面

1. **套图创建首页 `/suites/new`、`/suites/:suiteId`**：按原型保留商品图对比、生成简报、RAG 资料和最近项目结构；新建态使用 `/suites/new`，保存后跳转 `/suites/:suiteId`。
2. **套图创作工作台 `/suites/:suiteId/board`**：按原型保留创作板/成品展示板切换、画布节点、卡片网格、右侧创作参数栏，以及卡片编辑、图片预览、删除确认和资源库弹窗；批量生成按钮明确显示 `N 任务 -> N 首图`。
3. **单卡精修 `/suite-tasks/:taskId`**：可以是工作台卡片编辑弹窗或独立深链接，交互必须等价于原型的卡片编辑入口；当前版本、历史版本并排对比；提示词和允许参数编辑；生成一张新图；选择当前/终版。

路由进入时先拉取方案聚合数据，再订阅任务刷新；离开页面不丢草稿，显式保存或防抖保存均必须产生版本/更新时间。

## 4. 领域状态模型

### 4.1 方案状态

`draft -> inputs_saved -> base_pending/base_running -> base_ready/base_failed -> plan_pending/plan_running/plan_ready -> ready_to_create -> creating/partially_created/created`。

状态由服务端根据事实汇总，不允许前端直接写任意状态。无输入图不得进入计划或创作；计划 Schema 未通过不得进入 `ready_to_create`。

### 4.2 输入图与底图

- `InputImage`：稳定 ID、上传序号 1..6、原图对象键、thumb 对象键、哈希、尺寸、mime。
- `BaseImageVersion`：稳定版本 ID、输入图 ID、提示词快照、provider/model 摘要、状态、对象键；同一输入图多次生成只追加版本。
- 当前底图由 `input_images.current_base_version_id` 指向；历史版本不可变。

### 4.3 计划与卡片

- `PlanSnapshot` 保存模板版本、动态输入、人工内容、Chunk 快照、LLM 输入/输出和 Schema 版本。
- 每个计划项创建一个稳定 `SuiteTask`；卡片状态为 `incomplete | pending | generating | generated | refining | failed | archived`。
- 卡片归档为软状态，保留所有任务、尝试、版本和审计记录。

### 4.4 生成与版本

`GenerationBatch` 表示一次批量或单卡动作；每个任务动作创建一个 `ResultSlot`，每个 provider 调用创建一个 `GenerationAttempt`。成功且对象已写入 MinIO 后才能创建不可变 `ImageVersion`；失败只保存 attempt。

首批：对当前 N 个非归档任务各创建一个 slot，严格得到 N 次调用和最多 N 个首图。单卡：每次创建一个 slot 和最多一张新图。新增卡片只创建新 task，不修改旧 task。

## 5. PostgreSQL 数据模型

使用专属 schema（建议 `suite_workbench`）。所有表使用 UUID 主键、`created_at`、`updated_at`；业务时间统一 UTC。对象键只存键，不存永久 URL。

核心表：

- `suites(id, name, status, plan_snapshot_id, created_at, updated_at)`。
- `input_images(id, suite_id, ordinal, original_object_key, thumb_object_key, sha256, width, height, mime_type, current_base_version_id, archived_at)`。
- `base_image_versions(id, input_image_id, version_no, status, prompt_snapshot_json, provider_snapshot_json, object_key, process_object_keys_json, error_code, error_message)`。
- `prompt_templates(id, stage, version, schema_json, body, active, created_at)`；阶段枚举为 `base_refine | plan | task_image`。
- `plan_snapshots(id, suite_id, template_id, template_version, dynamic_input_json, human_input_json, chunk_snapshot_json, llm_request_json, llm_response_json, schema_version, status, error_code)`。
- `plan_items(id, plan_snapshot_id, ordinal, purpose, description, prompt, required_fields_json, source_json, archived_at)`。
- `suite_tasks(id, suite_id, plan_item_id, ordinal, purpose, prompt_draft, parameter_json, status, archived_at)`。
- `generation_batches(id, suite_id, kind, requested_count, status, idempotency_key, started_at, finished_at)`。
- `result_slots(id, batch_id, task_id, ordinal, status, selected_version_id)`。
- `generation_attempts(id, slot_id, attempt_no, provider, model, request_summary_json, status, error_code, error_message, external_request_id, started_at, finished_at)`。
- `image_versions(id, task_id, slot_id, version_no, object_key, process_object_keys_json, sha256, width, height, mime_type, prompt_snapshot_json, context_snapshot_json, is_current, is_final, created_at)`。
- `chunk_snapshots(id, plan_snapshot_id, source_chunk_id, source_version, content, metadata_json, content_sha256)`。
- `audit_events(id, suite_id, task_id, action, actor_type, request_id, payload_json, created_at)`。

关键约束：

- `input_images`: `UNIQUE(suite_id, ordinal)`，ordinal 在 1..6；suite 至少一张图才能创作。
- `base_image_versions`: `UNIQUE(input_image_id, version_no)`；current 指针必须属于同一 input_image。
- `suite_tasks`: 同一有效 plan item 至多一个 task；ordinal 在同一 suite 内唯一（归档任务仍占用其 ID）。
- `generation_batches`: `UNIQUE(suite_id, idempotency_key)`；客户端重试不重复创建批次。
- `generation_attempts`: `UNIQUE(slot_id, attempt_no)`；attempt 只追加。
- `image_versions`: `UNIQUE(task_id, version_no)`；数据库触发器或事务保证每个 task 至多一个 `is_current`、至多一个 `is_final`。
- 外键全部 `ON DELETE RESTRICT`；业务删除采用归档。
- 错误消息可展示但必须经过敏感信息清洗。

### 5.1 迁移顺序

1. schema、扩展和通用 UUID/时间约定；
2. suites、input_images、base_image_versions；
3. templates、plan_snapshots、chunk_snapshots、plan_items；
4. suite_tasks、generation_batches、result_slots、generation_attempts；
5. image_versions、audit_events、索引和 current/final 约束；
6. 开发 seed（模板和 fake Chunk，不含真实业务数据）。

每个迁移可重复执行检查、向前兼容一版 API；禁止把 RAG 业务表迁入该 schema。

## 6. MinIO 设计

使用专属 bucket，例如由部署配置提供的 `PICAGENT_SUITE_BUCKET`；规格不固化服务器名称。对象键：

```text
suites/{suiteId}/inputs/{inputId}/original
suites/{suiteId}/inputs/{inputId}/thumb
suites/{suiteId}/inputs/{inputId}/base/{baseVersionId}/process/{step}.png
suites/{suiteId}/inputs/{inputId}/base/{baseVersionId}/final.png
suites/{suiteId}/tasks/{taskId}/versions/{versionId}/process/{step}.png
suites/{suiteId}/tasks/{taskId}/versions/{versionId}/final.png
```

上传流程：API 校验数量、mime、大小和哈希 -> 写 original -> 生成并写 thumb -> 单事务写 PG 元数据；任一步失败返回失败且不暴露内部地址。生成流程：worker 从 MinIO 读取输入 -> provider 返回 b64 或 URL -> 若为 URL 立即服务端下载 -> 校验图片 -> 写不可变对象 -> 成功事务写 `image_versions`。读取流程：API 校验对象归属后返回短期 presigned URL，或流式代理；前端不持久化 URL。清理只处理已确认无业务引用的临时对象，V1 不做激进 GC。

## 7. Provider 与外部 LLM/RAG 边界

### 7.1 gpt-image-2 provider

业务层只依赖稳定接口：

```text
ImageProvider.generateText(input: ImageTextRequest): Promise<ImageProviderResult>
ImageProvider.edit(input: ImageEditRequest): Promise<ImageProviderResult>
```

输入包含冻结 prompt、参考图字节/对象键、size、quality、model、requestId、attemptId；provider 强制 `n=1`，默认要求 `response_format=b64_json`，并返回统一 `{bytes, mimeType, externalRequestId, rawSummary}`。`rawSummary` 只能是脱敏摘要。

`generateText` 调 `/v1/images/generations`；`edit` 调 `/v1/images/edits` multipart，图片从 MinIO 读取后上传。base 精修使用 edit；卡片可按任务是否有底图选择 edit 或 text。URL 响应必须在 provider 内立即下载，超时、非图片、无 data 均转为可分类错误。

配置只从服务端环境读取：`IMAGE_GENERATION_BASE_URL`、`IMAGE_GENERATION_API_KEY`、`IMAGE_GENERATION_MODEL`。API key 不进入 DTO、日志、数据库快照或前端 bundle。

### 7.2 RAG Chunk 与 DashScope LLM

定义 `RagClient.search(query, filters)` 和 `LlmClient.generatePlan(input)` 两个适配边界。Chunk 搜索只返回候选摘要和稳定来源 ID；只有设计师明确勾选后，服务端按 ID 获取内容并冻结 `chunk_snapshots`。PicAgent 不修改 Chunk、不写入 RAG 数据。

LLM 输入包括模板版本、动态字段、人工字段和已选 Chunk 快照；默认“只补空字段”，不得覆盖人工填写内容；输出必须经过版本化 JSON Schema 校验。资料不足返回 `NEEDS_HUMAN_INPUT`，不允许模型虚构产品事实。DashScope 连接、模型名和超时由项目现有配置适配器提供，业务层不依赖 SDK 响应结构。

## 8. API 契约

所有写接口支持 `Idempotency-Key`；响应统一 `{data, requestId}`，错误统一 `{error:{code,message,details},requestId}`。

| 方法 | 路径 | 核心请求/响应 |
|---|---|---|
| POST | `/api/suites` | name -> suite 摘要 |
| GET | `/api/suites` | 最近方案分页 |
| GET | `/api/suites/:suiteId` | 可恢复的方案聚合状态 |
| POST | `/api/suites/:suiteId/input-images` | multipart image -> input + thumb |
| POST | `/api/suites/:suiteId/base-generation` | inputIds、templateVersion、prompt -> batch |
| GET | `/api/suites/:suiteId/templates?stage=` | 阶段模板及动态 Schema |
| POST | `/api/rag/chunks/search` | query、filters -> 候选 Chunk |
| POST | `/api/suites/:suiteId/plan` | template、dynamicInput、selectedChunkIds -> plan job |
| PATCH | `/api/suites/:suiteId/plan` | 人工修订后的 plan snapshot |
| POST | `/api/suites/:suiteId/tasks` | 新卡片字段 -> task |
| PATCH | `/api/suite-tasks/:taskId` | prompt/params/归档 -> task |
| POST | `/api/suites/:suiteId/generation` | taskIds -> batch（数量必须等于 task 数） |
| POST | `/api/suite-tasks/:taskId/generation` | prompt/params -> single batch |
| GET | `/api/suite-tasks/:taskId/versions` | 版本列表和脱敏快照 |
| POST | `/api/suite-tasks/:taskId/versions/:versionId/select` | `{selection: current\|final}` |
| POST | `/api/generation-attempts/:attemptId/retry` | 新 attempt/slot，不覆盖旧记录 |

异步写接口返回 `202` 和 job/batch ID；前端通过 `GET /api/generation-batches/:id` 或方案聚合轮询恢复状态。具体字段以共享 Schema 包为准。

## 9. 异步、重试与刷新恢复

API 事务先创建 batch、slot、attempt，再由 worker 执行 provider。worker 使用租约/心跳避免重复消费；状态转移采用 compare-and-set。可重试错误包括上游 5xx、超时、临时 MinIO/网络错误；参数校验、额度拒绝、无效图片不自动重试。手动重试追加 attempt，默认指数退避并设上限。

批量任务允许部分成功；每个 task 独立状态，batch 汇总 `completed | partial | failed`。浏览器刷新只重新 GET 方案和 batch，禁止根据本地 loading 状态推断结果。重启后 worker 扫描 `generating` 且租约过期的 attempt，标记可重试或失败。

## 10. 测试策略与验收

- **领域单测**：状态转移、N->N 计数、单卡单图、新增卡片不影响旧卡片、current/final 唯一性、模板阶段隔离。
- **契约测试**：请求/响应 Schema、错误码、幂等键、敏感字段清洗。
- **集成测试**：PostgreSQL 迁移与约束；MinIO fake/测试 bucket 的对象键、哈希和归属校验；provider fake 验证 generations/edits 参数与 `n=1`。
- **任务测试**：成功、部分失败、重试、worker 重启恢复和重复消费。
- **浏览器验收**：Playwright/等价桌面浏览器，在 1440x1000 完成上传 1–6 图、缩略图联动、底图版本切换、Chunk 勾选、计划编辑、N->N、单卡生成、新增卡片、版本选择、失败重试和刷新恢复；检查网络面板中未点击生成前没有生图请求。
- **数据验收**：测试结束查询 PG 业务关系和 MinIO 对象键；确认历史版本不覆盖、失败不生成伪版本、归档仍可追溯。

测试只断言外部行为和持久化结果，不绑定 React 组件实现或 provider 原始响应字段。真实第三方调用默认使用 fake；只有明确授权的安全 smoke 才可使用真实服务。

## 11. 安全边界

- `.env` 只由服务端/worker 读取；仓库仅提交 `.env.example` 变量名，不读取、打印或提交真实值。
- API key、Authorization、Cookie、生产数据、RAG 原文和临时签名 URL 不进入前端 bundle、浏览器 localStorage、数据库业务快照或日志。
- 日志只记录 requestId、suite/task/attempt ID、provider/model、耗时、状态和脱敏错误摘要。
- MinIO presigned URL 设短 TTL、最小权限和对象归属校验；不向上游发送永久公网对象 URL。
- 生产 PostgreSQL/MinIO 连接信息由部署环境注入；本地测试使用独立 fake/测试实例，禁止把生产数据复制到仓库。
- 输入文件类型、大小、像素上限和图片解码结果必须服务端校验；对象键由服务端生成，不接受客户端任意路径。

## 12. 开发门槛与暂停点

实现顺序遵循 PRD：基础配置和迁移 -> MinIO -> provider -> 首页底图 -> RAG/LLM 计划 -> 创作板和版本 -> 浏览器及恢复验收。开始正式编码前需要确认：RAG 检索/Chunk 获取接口、DashScope 项目配置读取方式、服务器 PostgreSQL/MinIO 连接方式、以及任务 worker 的部署形态。以上确认完成前，本规格作为评审稿，不进入业务实现。

## 13. Out of Scope

登录权限、数据中台与清洗、RAG 入库/编辑、移动端、多人协同、像素级画布、视频、其他套图模式和电商发布均不在本规格内。

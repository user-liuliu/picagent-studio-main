# 电商智能生图 agent 项目导学

> 简称：电商智能生图 agent
> 求职方向：AI 应用开发
> 事实口径：本文优先依据当前仓库代码、测试、验收记录和项目文档整理。没有线上业务指标的地方统一标为“待补/待测”，不把原型或 PRD 当成已经上线的能力。

## 1. 前置知识

| 知识点 | 为何需要 | 在本项目中的位置 | 高频度 |
|---|---|---|---|
| TypeScript 与 React 状态管理 | 需要理解创建页、工作台、资源库和反推页如何组织状态、请求和恢复 | `src/pages/StartPage.tsx`、`src/pages/BoardPage.tsx`、`src/pages/ReversePage.tsx`、`src/pages/StyleLibraryPage.tsx` | 高 |
| HTTP API 与异步任务 | 图片生成、LLM 规划、OCR 都不是可靠的同步短请求，需要理解 202、轮询、失败和重试 | `server/app.ts`、`src/api/client.ts`、`server/index.ts` | 高 |
| LLM 输出约束与 JSON Schema 思维 | 模型输出要先解析、归一化、校验，才能进入计划快照和任务卡 | `server/app.ts` 中的 `normalize*` / `validate*`、`server/providers/dashscope-llm-client.ts` | 高 |
| Prompt Engineering 与模板版本 | 模板正文、动态输入、用户补充、RAG Chunk 和最终提示词需要分层并冻结 | `server/prompt-library.ts`、`server/suite-task-prompt.ts`、`prompt/normalized/` | 高 |
| RAG 基本概念与来源追溯 | 商品事实不是模型自由发挥，设计师要显式勾选 Chunk，服务端保存来源版本和内容快照 | `server/repositories/postgres-rag-client.ts`、`src/pages/StartPage.tsx`、`db/migrations/006_plan_snapshots.sql` | 高 |
| 图像生成 API 与图生图 | 白底精修、单卡生图、反推画布生图都要理解图片输入、`n=1`、base64 和对象存储 | `server/providers/gpt-image-provider.ts`、`docs/gpt-image-2.md` | 高 |
| PostgreSQL 事务、约束和迁移 | 业务状态、版本、幂等、审计和血缘必须可恢复，不能只存在浏览器内存 | `db/migrations/001_suite_workbench.sql` 至 `021_image_edit_source_prompt.sql`、`server/repositories/` | 高 |
| 对象存储与图片处理 | 原图、缩略图、白底图、过程图、终版图和蒙版不适合直接塞进数据库 | `server/storage/minio-storage.ts`、`server/image.ts`、`server/index.ts` | 高 |
| XYFlow 与画布状态持久化 | 外层画布表达任务、版本和来源关系，节点拖动后的布局还要保存并处理版本冲突 | `src/pages/BoardPage.tsx`、`db/migrations/010_ticket06_tasks_canvas.sql` | 中高 |
| Konva / Canvas 坐标模型 | 图片编辑器需要文字框、OCR、笔刷、蒙版、扩图和归一化坐标，不能把 XYFlow 当像素画布 | `server/image-editor.ts`、`src/pages/WorkbenchBoardPage.tsx`、`docs/adr/0003-image-editor-tool-and-lineage.md` | 中高 |
| OpenTelemetry / Langfuse | AI 应用要能回答调用了什么模型、耗时多久、是否失败、用了多少 Token | `server/observability.ts`、`docs/adr/0004-langfuse-opentelemetry-observability.md` | 中高 |
| 幂等、版本化和可审计设计 | 重复点击、刷新、失败重试和人工修改不能制造重复或覆盖历史 | `src/api/client.ts` 的 `createIdempotencyKey`、各类 repository、相关测试 | 高 |

## 2. 重点亮点与学习顺序（先看这个）

| 亮点标题 | 为什么重要 | 通用技术关键词 | 先看哪些文件 | 建议学习顺序 |
|---|---|---|---|---|
| 两阶段 AI 编排与人工确认闸门 | 先让模型规划“要做哪些图”，再按类别生成独立提示词，减少一条请求塞入过多职责；人工确认后才物化任务 | LLM orchestration、human-in-the-loop、structured output、state gate | `docs/PRD-套图工作台-V1.1-分层套图规划.md`、`src/pages/StartPage.tsx`、`server/app.ts`、`db/migrations/013_prompt_v11_stages.sql`、`db/migrations/015_category_prompt_requests.sql`、`db/migrations/017_structure_plan_snapshot_fields.sql` | 1 |
| 事实约束与提示词快照 | 商品外观、参数和卖点必须有来源；模板、Chunk、人工补充和最终提示词都要绑定到一次生成 | RAG grounding、provenance、immutable snapshot、prompt versioning | `server/suite-task-prompt.ts`、`server/prompt-library.ts`、`db/migrations/006_plan_snapshots.sql`、`db/migrations/016_task_prompt_snapshots.sql` | 2 |
| 异步生成与不可变版本血缘 | 白底图、任务图、反推提示词和图片编辑都可能耗时或失败；每次尝试独立记录，成功才产生版本 | async job、attempt、retry、idempotency、lineage | `server/app.ts`、`server/repositories/postgres-task-repository.ts`、`server/image-editor.ts`、`tests/ticket06.task-contract.test.ts` | 3 |
| 多模态输入与产品外观真值 | 爆品参考图只提供构图/光影，产品白底图才是外观真值；最多三张有序白底图绑定到任务输入版本 | multimodal generation、input version、resource reference | `docs/SPEC-爆品图反推-V1.md`、`server/repositories/postgres-reverse-repository.ts`、`src/pages/ReversePage.tsx` | 4 |
| 双层画布与可解释编辑 | XYFlow 负责任务关系，Konva 负责像素级编辑上下文；编辑以框架无关快照保存，支持子卡片血缘 | XYFlow、Konva、normalized coordinates、mask、OCR | `src/pages/BoardPage.tsx`、`src/pages/WorkbenchBoardPage.tsx`、`server/image-editor.ts`、`docs/adr/0003-image-editor-tool-and-lineage.md` | 5 |
| 资源库、模板生命周期与可观测性 | 资源引用不能复制或覆盖历史；模板发布不可变；AI 调用还要有 trace、metric 和脱敏边界 | resource library、lifecycle、OTel、Langfuse、Prometheus | `src/pages/StyleLibraryPage.tsx`、`server/prompt-library.ts`、`server/observability.ts`、`docs/adr/0004-langfuse-opentelemetry-observability.md` | 6 |

## 3. 必备知识点

- [ ] 能画出“原图上传 -> 白底精修 -> 结构计划 -> 类别提示词 -> 任务卡 -> 生图版本”的时序图。
- [ ] 能解释为什么 `N 个任务 -> N 张首图`，以及为什么单卡每次只生成一张。
- [ ] 能区分模板版本、计划快照、类别请求、任务提示词快照和图片版本。
- [ ] 能说清 RAG Chunk 为什么必须人工勾选、服务端为什么还要冻结来源版本。
- [ ] 能解释失败 attempt、重试 attempt、当前版本和终版选择之间的关系。
- [ ] 能解释反推参考图和产品白底图的事实边界，避免把参考商品信息迁移到结果。
- [ ] 能解释 XYFlow 和 Konva 的职责边界，以及为什么不能只保存 Konva Stage JSON。
- [ ] 能说明 PostgreSQL 与 MinIO 各自保存什么，为什么不把图片二进制全部存 PG。
- [ ] 能说明幂等键覆盖哪些写操作，以及重复请求如何返回原业务记录。
- [ ] 能说明 Provider 适配层如何隔离 DashScope、生图接口、OCR 和后续供应商替换。
- [ ] 能说明 Langfuse/OpenTelemetry 如何记录调用证据，同时避免密钥、认证头、base64 进入日志。
- [ ] 能从测试中找出已验证边界，而不是用“应该可以”替代证据。

## 4. 推荐阅读（结合仓库）

| 主题 | 通用技术点 | 建议阅读位置 | 预计时间 | 读完能回答什么 |
|---|---|---|---:|---|
| 先理解产品边界 | 领域建模、范围控制、桌面端工作流 | `README.md`、`CONTEXT.md`、`docs/PRD-套图工作台-V1.md` | 25 分钟 | 这个项目解决什么问题，首版明确不做什么？ |
| 真实入口和路由 | React 页面路由、浏览器 history、页面职责 | `src/app/App.tsx`、`src/pages/StartPage.tsx` | 25 分钟 | 用户如何从创建页进入套图、风格库和爆品图反推？ |
| 原图与白底精修 | 图片上传、校验、缩略图、图生图、历史版本 | `server/image.ts`、`server/app.ts` 中 input/base generation 路由、`db/migrations/001_suite_workbench.sql`、`db/migrations/002_base_image_generation.sql` | 35 分钟 | 为什么点击生成前不调用模型，重复生成如何保留历史？ |
| 模板与提示词 | 模板阶段隔离、动态字段、发布/复制/下线、提示词归档 | `server/prompt-library.ts`、`server/prompt-archive.ts`、`prompt/normalized/README.md`、`db/migrations/004_prompt_library.sql`、`db/migrations/005_prompt_template_versions.sql` | 40 分钟 | 为什么运行时只能使用已发布模板，模板修改如何不影响历史？ |
| RAG 资料选择 | 显式选择、来源版本、事实快照、缺失事实 | `src/pages/StartPage.tsx` 的 `RagReferences`、`server/repositories/postgres-rag-client.ts`、`db/migrations/006_plan_snapshots.sql` | 35 分钟 | 模型的商品事实从哪里来，未选择资料时系统如何避免虚构？ |
| 结构计划 V1.1 | 两阶段编排、类别分配、确认闸门、部分失败 | `docs/PRD-套图工作台-V1.1-分层套图规划.md`、`docs/TECH-SPEC-套图工作台-V1.1-分层套图规划.md`、`server/app.ts` 的 structure/category 路由、`db/migrations/013_prompt_v11_stages.sql` 至 `017_structure_plan_snapshot_fields.sql` | 50 分钟 | 为什么先生成结构计划，再按类别生成独立提示词？ |
| 任务卡与图片版本 | 任务、批次、槽位、attempt、版本选择、归档 | `src/pages/BoardPage.tsx`、`src/api/client.ts`、`server/repositories/postgres-task-repository.ts`、`db/migrations/010_ticket06_tasks_canvas.sql` | 45 分钟 | 批量生成、单卡生成、失败重试和终版选择如何工作？ |
| XYFlow 工作台 | 节点投影、边关系、拖拽布局、防抖保存、版本冲突恢复 | `src/pages/BoardPage.tsx`、`db/migrations/010_ticket06_tasks_canvas.sql`、`tests/ticket06.task-contract.test.ts` | 35 分钟 | 为什么画布布局是业务状态的一部分，刷新后如何恢复？ |
| 风格库与引用 | 资源分类、模板/图片分栏、资源状态、引用快照 | `src/pages/StyleLibraryPage.tsx`、`server/repositories/postgres-library-repository.ts`、`db/migrations/011_ticket07_library_references.sql`、`db/migrations/012_style_library_assets_v1.sql` | 35 分钟 | 工作台如何引用资源而不是复制资源，过程图为什么只能查看？ |
| 爆品图反推 | 逐图独立反推、主图/详情图模式、色彩基准、多图输入 | `src/pages/ReversePage.tsx`、`docs/SPEC-爆品图反推-V1.md`、`server/repositories/postgres-reverse-repository.ts`、`db/migrations/018_product_reverse_v1.sql`、`db/migrations/019_reverse_shared_canvas.sql` | 50 分钟 | 反推提示词如何进入共享画布，如何防止参考商品事实污染生成？ |
| 图片编辑器 | 编辑操作、OCR、归一化坐标、mask、子卡片血缘、能力矩阵 | `src/pages/WorkbenchBoardPage.tsx`、`server/image-editor.ts`、`server/image-editor-api.ts`、`db/migrations/020_image_editor.sql`、`docs/adr/0003-image-editor-tool-and-lineage.md` | 60 分钟 | 为什么编辑提交要冻结快照，为什么不允许 Provider 不支持时静默降级？ |
| Provider 与存储 | OpenAI-compatible 图像接口、DashScope LLM/OCR、MinIO、服务端密钥 | `server/providers/gpt-image-provider.ts`、`server/providers/dashscope-llm-client.ts`、`server/providers/dashscope-ocr-provider.ts`、`server/storage/minio-storage.ts`、`server/config.ts` | 40 分钟 | 供应商响应如何被适配，密钥和临时 URL如何不泄露？ |
| 可观测性 | Trace、generation/tool span、Prometheus 指标、脱敏策略 | `server/observability.ts`、`docs/adr/0004-langfuse-opentelemetry-observability.md`、`docs/research-ai-observability-frameworks.md` | 30 分钟 | 出错时如何定位是 RAG、LLM、图像 Provider 还是业务持久化？ |
| 测试与真实验收 | 契约测试、幂等测试、浏览器验收、构建/typecheck | `tests/`、`docs/ACCEPTANCE-套图工作台-V1.1-真实验收.md`、`artifacts/real-qwen-v11-acceptance.json` | 40 分钟 | 哪些能力已经有证据，哪些仍需要补真实环境测试？ |

## 5. 自学提醒

若某文件或原理看不懂，请继续追问 AI；本技能负责给学习路径与题目，不提供逐行讲解。

建议每次只追一条真实链路，例如从 `POST /api/suites/:suiteId/structure-plan` 追到页面轮询、服务端校验、repository 写入和测试断言，再换下一条链路。学习时优先问“真正的状态在哪里产生、在哪里持久化、刷新后从哪里恢复”，不要只看页面文案。

## 6. 项目技术定位

**AI 应用开发为主，交叉全栈工程。**

依据是：项目以 LLM 结构化规划、RAG 事实引用、图像生成、OCR 和提示词版本为业务核心，同时由 React/Vite 前端、Node/TypeScript 服务端、PostgreSQL、MinIO、XYFlow/Konva 和 OTel 共同支撑完整闭环。它不是单纯的模型 Demo，也不是只做页面的前端项目。

## 7. 核心原理解析

### 7.1 从“一次大提示词”拆成两阶段规划

- **问题：** 一次请求直接生成大量卡片提示词时，每条提示词容易职责混杂、描述过短，且很难让设计师确认数量和类别。
- **机制：** 第一阶段由 LLM 输出结构计划，包含主图数量、详情类别分配、参考图、事实引用、缺失事实和全局风格卡；设计师修改并确认后，第二阶段按类别独立请求完整提示词。
- **在本项目中的落点：** `structure_plan` 和 `category_prompt` 是独立模板阶段；`StartPage` 展示结构审核和类别进度；服务端只有在确认快照后才允许创建任务卡。

### 7.2 用快照把 AI 输入变成可追溯事实

- **问题：** 模板会更新，RAG Chunk 会产生新版本，任务草稿也会被人工修改；如果只保存最终文本，无法解释图片是依据什么生成的。
- **机制：** 每次规划和生图都冻结模板版本、动态输入、人工补充、Chunk 来源版本、图片引用、模型配置和实际完整提示词；历史记录只追加，不原地覆盖。
- **在本项目中的落点：** `plan_snapshots`、`plan_chunk_snapshots`、任务 `promptSnapshot/contextSnapshot` 和图片版本表共同形成血缘链。

### 7.3 以 attempt 和 version 分离失败与成功

- **问题：** 模型请求可能超时、返回非法 JSON、Provider 失败或图片处理失败。若失败也写成图片版本，会产生伪造结果；若只保留当前图，历史又无法比较。
- **机制：** 一次调用先记录 generation attempt；只有成功且图片经过处理后才创建不可变 image version。重试追加新的 attempt，并通过 `retryOf` 关系指向原失败记录。
- **在本项目中的落点：** 批量生成使用 batch/slot/attempt/version 四层记录；单卡生成只新增一张图；当前版和终版是选择关系，不复制图片。

### 7.4 把参考图和产品事实分成两条边界

- **问题：** 爆品参考图有优秀构图和版式，但其中的品牌、Logo、价格、参数和商品外观不能迁移到用户自己的产品。
- **机制：** 反推提示词声明产品白底图是唯一外观来源，爆品图只提供构图、光影、色彩和信息排版；最终生成任务冻结有序产品白底图素材组、可选爆品参考图和提示词版本。
- **在本项目中的落点：** 反推方案独立于套图计划；进入共享画布后才绑定 1–3 张白底资源，并将输入变化记为新的任务输入版本。

### 7.5 外层流程画布和内层图片编辑分工

- **问题：** XYFlow 擅长节点、连线和任务组织，但不适合承载文字框、蒙版、笔刷和 OCR 坐标；把两者混用会让业务状态与像素状态互相污染。
- **机制：** XYFlow 只表达父任务、子任务、版本、来源和布局；Konva 只负责图片编辑场景。持久化只保存框架无关的归一化 `EditSnapshot`，不保存 Stage JSON。
- **在本项目中的落点：** `BoardPage` 管理外层 React Flow，`WorkbenchBoardPage`/编辑服务管理内层编辑上下文，编辑生成后创建子卡片并保留父版本关系。

### 7.6 Provider 适配与可观测性解耦

- **问题：** 不同模型供应商返回字段、错误格式、图片编码和能力不一致；如果业务层直接依赖供应商字段，替换模型会牵动所有路由。
- **机制：** 用 `ImageProvider`、`LlmClient`、`OcrProvider` 和 `ImageEditProvider` 作为稳定边界；观测层只记录通用 flow/provider/model/status/duration/usage，内容采集受环境开关控制。
- **在本项目中的落点：** `server/providers/` 隔离外部调用，`server/observability.ts` 提供 generation/tool span 与 Prometheus 指标，观测不可用时不阻塞业务调用。

## 8. 关键设计决策

| 决策 | 备选 | 取舍 | 风险 | 验证 |
|---|---|---|---|---|
| 两阶段结构计划 + 类别提示词 | 一次 LLM 请求直接输出所有卡片 | 多一次编排和状态管理，但每张图职责更清晰、可人工确认 | 类别请求部分失败时需要恢复与重试 | `tests/ticket04*`、`tests/ticket05*`、真实验收记录 |
| `N -> N` 且 `n=1` | 一次请求生成多张候选 | 生成成本和结果数量可控，历史关系简单 | 设计师需要多次单卡生成候选 | `tests/ticket06.task-contract.test.ts`、真实生图验收 |
| PostgreSQL + MinIO | 全部存数据库或浏览器本地 | PG 保存关系和快照，MinIO 保存大对象，适合追溯 | 需要处理对象键、哈希、清理和权限 | migration 约束、MinIO adapter、preview API |
| RAG Chunk 显式勾选 | 自动把全部召回结果送给模型 | 事实边界由设计师确认，降低无关或错误资料进入模型的风险 | 操作多一步，资料不足时需要人工补充 | `StartPage` 勾选逻辑、plan snapshot tests |
| 模板已发布版本不可变 | 原地修改一份模板 | 历史任务可复现，模板变更有版本语义 | 模板维护需要复制/发布流程 | `prompt-library.ticket.test.ts`、数据库状态约束 |
| XYFlow + Konva 双层画布 | 只用 XYFlow 或浏览器本地合成 | 任务编排和像素编辑各自使用合适工具 | 两套坐标/状态同步复杂 | `docs/adr/0003*`、`image-editor.contract.test.ts` |
| Provider 能力不足时阻止 | 静默降级为普通 prompt | 不伪装成支持了 mask/改字/多图输入 | 用户需要理解能力提示并换方案 | capability API、编辑器契约测试 |
| 观测与业务事实分离 | 只打普通日志或让观测平台成为业务数据库 | Langfuse/OTel 用于定位和成本，PG/MinIO 才是业务真相 | 需要脱敏和采集开关 | `server/observability.ts`、ADR 0004 |

## 9. 量化与验证（含待测，建议）

当前已有的可核验证据：本次复跑的 `npm run typecheck`、`npm run build` 和 `npx tsx --test tests/*.test.ts` 均通过，其中测试为 116/116；历史真实验收记录（2026-08-26）显示当时 Ticket 01–06 通过、测试为 81/81，且真实 QWEN 结构计划、类别提示词、`gpt-image-2` 白底图和主图链路已跑通。历史证据以 `docs/ACCEPTANCE-套图工作台-V1.1-真实验收.md` 和 `artifacts/real-qwen-v11-acceptance.json` 为准。

建议补齐并记录以下指标：

| 指标 | 测量方法 | 当前状态 |
|---|---|---|
| 结构计划成功率 | 按 `plan_generation_attempts` 统计成功/失败，并按 Provider、模板版本分组 | 待测 |
| 类别提示词成功率 | 按 `plan_category_requests` 统计首请求成功率、重试率和部分成功率 | 待测 |
| 单卡生图耗时 | OTel `picagent_image_request_duration_ms` 记录 P50/P95 | 已有埋点，待形成基线 |
| LLM 耗时与 Token | OTel model duration、input/output token counter 按 flow/provider/model 分组 | 已有埋点，待形成基线 |
| 端到端任务完成率 | 从结构计划确认到至少一张可选终版图的方案比例 | 待测 |
| 刷新恢复正确率 | 在生成中、失败、部分类别成功、画布拖拽后刷新，比较服务端状态与 UI 状态 | 已有部分验收，建议扩大样本 |
| 幂等重复写入 | 对上传、生成、重试、保存、布局保存重复发送同一幂等键，确认业务记录数量不增加 | 有契约测试，建议补 API 级回归 |
| 事实污染率 | 抽样检查反推生成结果是否出现参考商品品牌、参数、价格或 Logo | 待测，必须人工评审 |
| 产品保真率 | 设计师盲评商品结构、比例、颜色、材质和可见细节 | 待测，不应虚构自动评分 |
| 资源引用可解释性 | 随机打开历史任务，核对模板、Chunk、白底图、反推参考图和完整提示词快照 | 待测 |
| 编辑器坐标稳定性 | 在不同视口、缩放、面板尺寸下编辑文字和蒙版，验证归一化坐标重放 | 有契约测试，建议补浏览器矩阵 |

面试时建议把“当前复跑 116/116、历史真实模型跑通、typecheck/build 通过”说成有时间边界的仓库验收证据；历史记录中的 81/81 属于 2026-08-26 的快照。效率提升、成本下降、用户规模、准确率和线上延迟都应先补真实数据再写成数字。

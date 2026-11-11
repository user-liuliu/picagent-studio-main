# Ticket 04：提示词入库

状态：已实现并完成目标 PostgreSQL 导入
日期：2026-08-23

## 目标

把指定对话确认过的 `prompt/prompt.md` 中可执行的提示词代码块导入 PicAgent 专属 PostgreSQL `prompt_library` schema，并为套图创建页提供按阶段读取的模板元数据。

## 范围

- 标题作为模板名称，紧邻的 Markdown fenced code block 作为正文。
- 模板按 `base_refine`、`plan`、`task_image` 阶段分类，并显式标记 LLM 或 image model 执行目标。
- 模板正文存在“用户输入区”时严格按该模板提取动态字段；旧模板未声明输入区时，按主图、详情页或整套类型补齐对应的通用字段。
- 导入创建 `draft` 不可变版本并保留源文件、标题和 SHA-256；维护者用 `--publish` 显式发布，同源重复导入幂等，正文变化追加版本。
- `GET /api/prompt-templates?stage=...` 只返回已发布版本的身份、名称、阶段、执行目标、输入 Schema 和适用性，不返回正文。
- 白底精修提交 `templateVersionId + dynamicInput`，服务端从 PG 读取已发布正文，按版本 Schema 校验并在生成尝试中冻结版本与输入快照。

## 验收证据

- `npm run import-prompts -- prompt/prompt.md --dry-run` 可解析 21 个可执行 fenced prompt。
- 其中 16 个为计划模板、1 个为底图精修模板、4 个为返修模板。
- 目标 PostgreSQL 已发布 21 个 v3：`plan=16`、`base_refine=1`、`task_image=4`；旧版本保留并退役。
- 16 个计划模板的已发布 Schema 均非空；海产品模板包含真实规格、净含量、产地、储存、发货和食用方式等专属字段，“可选模特与人脸规则”模板包含站点、品类、模特、人脸和图中文字规则。
- 创建页默认填充可编辑的演示数据；空方案按钮显示“上传图片”，已有图片后显示“继续加图”。
- 底图精修提交立即返回后台任务，页面每秒拉取生成历史，成功或失败后自动退出“生成中”。
- 桌面端图片使用稳定容器约束，缩略图删除按钮位于卡片内部，长文件信息不会撑破卡片。
- 现有对话确认的 26 个名称中，有 5 个在源 Markdown 中没有 fenced code block，因此本 ticket 不猜测正文、不入库：美妆日化详情页、服饰主图、老檀木主图、老檀木详情页、家具纯视觉主图。补齐代码块后重新执行导入即可。
- `npx tsx --test tests/prompt-library.ticket.test.ts tests/ticket02.contract.test.ts tests/ticket02.encoding.test.ts tests/ticket03.contract.test.ts` 通过。
- `npm run build` 通过。

## 使用

```text
npm run import-prompts -- prompt/prompt.md --dry-run
npm run import-prompts -- prompt/prompt.md
npm run import-prompts -- prompt/prompt.md --publish
```

正式导入命令只读取服务端 `.env` 中的 PostgreSQL 配置，不打印连接信息、密钥或正文；不带 `--publish` 时只生成草稿版本。

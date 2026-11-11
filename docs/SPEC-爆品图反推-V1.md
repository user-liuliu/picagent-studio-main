# SPEC-爆品图反推-V1

> 文档状态：已确认（V1.1 白底图多素材生图契约）
> 更新日期：2026-09-01

> 状态：已确认，可进入实现
> 版本：V1.1
> 日期：2026-09-01
> 主要依据：《PRD-爆品图反推-V1》
> 交互依据：爆品图反推桌面原型

本规格以 PRD 为权威来源。原型用于确定桌面端三栏布局、控件位置和可见交互；原型中的示例图片、模拟提示词、Toast 和静态状态不构成真实数据或后端实现要求。PRD 与原型冲突时以 PRD 为准。

## Problem Statement

PicAgent 创建页当前仍保留没有真实能力的“全能模式”占位。设计师面对爆品主图或详情页参考图时，只能在外部工具中逐张上传、手工选择提示词、复制结果，再回到生图工作台绑定自己的产品图。这导致以下问题：

- “全能模式”名称无法表达真实工作任务，入口不可用；
- 爆品参考图、反推模板、反推提示词和后续生图任务缺少统一关系；
- 多张参考图容易被错误合并，无法保证一张参考图对应一条独立提示词；
- 主图和详情图使用不同的反推规则，但当前没有明确的模式和模板边界；
- 详情图需要系列色彩一致，同时又不能混合各屏的场景、构图和道具；
- 设计师修改后的提示词缺少版本化保存和后续任务快照；
- 外部反推结果进入套图工作台时，参考图、提示词和产品白底图之间无法追溯；
- 生成结果需要设计师人工判断产品保真和视觉效果，不适合引入未经验证的机器评分或自动阻断。

设计师需要一个明确、可重复、可追溯的“爆品图反推”流程：上传参考图，为每张图选择模板，得到独立提示词，修改并保存，然后把参考图和提示词带入现有共享 XYFlow 画布，继续绑定产品白底图和生成商品图。

## Solution

使用“爆品图反推”直接替换创建页的“全能模式”入口，不保留旧占位。

爆品图反推提供独立桌面页面，采用三栏工作台：

- 左侧选择主图反推或详情图反推，并执行批量反推、保存方案和进入共享画布；
- 中间上传、排序和管理最多 16 张爆品参考图，每张图单独选择一个反推模板；
- 右侧查看并编辑当前参考图对应的完整中文提示词，支持保存、重新反推和复制。

每张参考图独立创建一次反推请求和一条提示词，不自动合并多张图的非色彩元素。详情图模式允许选择一张系列色彩基准图，该基准只提供整组色彩和光影秩序，其他视觉元素仍逐图独立处理。

反推页面不上传产品原图或白底图，也不直接生成商品图。设计师将已有反推结果带入现有共享 XYFlow 画布后，再从图片资源库窗口选择 1–3 张产品白底图并确认使用。画布按以下关系追加节点并保持可点击映射：

`爆品参考图 + 反推提示词 + 产品白底图素材组 -> 生图任务 -> 生成结果`

系统保存反推方案、参考图顺序、模板版本、请求状态、LLM 原始输出、用户编辑结果和进入画布时使用的提示词快照。生图任务输入版本冻结当前有效提示词、最多 3 张有序白底图资源版本、爆品参考图版本、是否使用爆品图参考及生成参数。生成图片由设计师人工校验，不提供机器保真评分或自动通过结论。

## User Stories

1. As an internal ecommerce designer, I want the old “全能模式” entry replaced by “爆品图反推”, so that the entry accurately describes the available workflow.
2. As an internal ecommerce designer, I want to open a real reverse-prompt workspace from the creation page, so that I do not encounter another reserved interface.
3. As an internal ecommerce designer, I want to choose either 主图反推 or 详情图反推 for a plan, so that the system applies the correct visual-analysis rules.
4. As an internal ecommerce designer, I want one reverse plan to use only one top-level mode, so that main-image and detail-image rules do not become mixed.
5. As an internal ecommerce designer, I want 主图反推 selected by default for a new plan, so that the most common entry has a predictable starting state.
6. As an internal ecommerce designer, I want to upload a single reference image, so that I can reverse one successful image without creating a batch.
7. As an internal ecommerce designer, I want to upload multiple reference images, so that I can process a collection of successful images in one plan.
8. As an internal ecommerce designer, I want to upload up to 16 reference images, so that a split detail page can be processed as one ordered set.
9. As an internal ecommerce designer, I want the seventeenth image to be rejected with a clear message, so that the plan limit is predictable.
10. As an internal ecommerce designer, I want JPG, PNG, and WebP reference images accepted, so that common downloaded ecommerce assets can be used directly.
11. As an internal ecommerce designer, I want uploaded images shown as ordered thumbnails, so that I can understand the sequence at a glance.
12. As an internal ecommerce designer, I want to remove a reference image from the current plan, so that irrelevant or incorrect inputs do not enter prompt generation.
13. As an internal ecommerce designer, I want to drag reference images into a new order, so that prompt output and canvas nodes follow the intended sequence.
14. As an internal ecommerce designer, I want reordering to preserve existing saved prompts, so that a layout adjustment does not silently overwrite work.
15. As an internal ecommerce designer, I want each reference image to choose its own template, so that different visual duties are handled explicitly.
16. As an internal ecommerce designer, I do not want an “apply this template to all images” action, so that template choices remain deliberate per image.
17. As an internal ecommerce designer, I want only templates applicable to the current top-level mode shown, so that I cannot select a detail template for a main-image plan.
18. As an internal ecommerce designer, I want template name, version, purpose, and input requirements visible when choosing a template, so that I can select it intentionally.
19. As a template maintainer, I want hidden template bodies to remain server-side, so that published prompt IP is not exposed to the browser.
20. As an internal ecommerce designer, I want the first main-image template set to cover white-background, scene, selling-point, and promotion layouts, so that common main-image patterns are available.
21. As an internal ecommerce designer, I want the first detail-image template set to cover hero/brand, core selling point, lifestyle, detail close-up, size/specification, and promotion/trust layouts, so that common detail-page duties are available.
22. As an internal ecommerce designer, I want every reference image to generate its own detailed prompt, so that each output preserves its own composition and visual duty.
23. As an internal ecommerce designer, I do not want non-color elements from different reference images merged automatically, so that scenes, props, and layouts do not contaminate one another.
24. As an internal ecommerce designer, I want to start all eligible reverse requests with one batch action, so that multi-image work does not require repetitive clicks.
25. As an internal ecommerce designer, I want the batch to remain a collection of independent requests, so that one failure does not invalidate successful prompts.
26. As an internal ecommerce designer, I want waiting, running, succeeded, and failed states per image, so that I can see actual progress.
27. As an internal ecommerce designer, I want a failed image to display a useful error and allow a single-image retry, so that I can recover without rerunning the batch.
28. As an internal ecommerce designer, I want retries preserved as new attempts, so that failures and later successes remain traceable.
29. As an internal ecommerce designer, I want running requests restored after refresh, so that temporary navigation does not turn active work into false failure.
30. As an internal ecommerce designer, I want a deterministic error when the LLM provider is unavailable, so that the system never reports fake success.
31. As an internal ecommerce designer, I want invalid model output rejected before a prompt is saved, so that malformed responses do not enter the workspace.
32. As an internal ecommerce designer, I want the prompt output in Chinese, so that it is directly usable in the current production workflow.
33. As an internal ecommerce designer, I want the prompt to be independently executable later with only my product white-background image, so that the successful reference image is not required during final generation.
34. As an internal ecommerce designer, I want the product white-background image declared as the only source of product appearance, so that the reference product does not replace or distort my product.
35. As an internal ecommerce designer, I want reference brands, logos, parameters, claims, certifications, and promotion copy excluded from product facts, so that unverified information is not transferred.
36. As an internal ecommerce designer, I want uncertain product copy expressed as placeholders, so that real copy can be supplied later instead of being invented.
37. As an internal ecommerce designer, I want the prompt to describe layout independently rather than saying “replace the original product”, so that the final image model can execute it without the original reference image.
38. As an internal ecommerce designer, I want a detail-image plan to default to the first image as its series color baseline, so that a coherent series can be produced quickly.
39. As an internal ecommerce designer, I want to choose a different series color baseline, so that the strongest visual direction can govern the set.
40. As an internal ecommerce designer, I want the series color baseline to control only color and lighting order, so that each detail screen keeps its own scene, composition, props, and material relationships.
41. As an internal ecommerce designer, I want changing the color baseline to affect only new or explicitly regenerated prompts, so that saved work is not silently changed.
42. As an internal ecommerce designer, I want to click a reference-image card and inspect its prompt in the right panel, so that multi-image browsing remains compact.
43. As an internal ecommerce designer, I want to edit the complete prompt directly, so that I can correct or refine the model result.
44. As an internal ecommerce designer, I want to save my edited prompt, so that my version becomes the effective version for later generation.
45. As an internal ecommerce designer, I want an LLM regeneration to preserve the previous prompt version, so that I can recover earlier work.
46. As an internal ecommerce designer, I want to copy the current complete prompt, so that it can be reviewed or used in another approved workflow.
47. As an internal ecommerce designer, I do not want separate editable panels for summaries, invariants, and forbidden items, so that the editing experience stays simple.
48. As an internal ecommerce designer, I do not want a draft/confirmed state switch for every prompt, so that generated results can be edited and saved without an approval ceremony.
49. As an internal ecommerce designer, I want the current reverse plan saved and restored, so that I can continue work after refresh or reopening.
50. As an internal ecommerce designer, I want a saved result archived as a reusable 爆品图反推资产, so that the visual structure can be found again.
51. As an internal ecommerce designer, I want the asset to retain its reference image, prompt, template version, and source snapshot, so that reuse remains explainable.
52. As an internal ecommerce designer, I want to enter the shared XYFlow canvas after at least one prompt succeeds, so that I can continue into image generation.
53. As an internal ecommerce designer, I want only existing reference-image and prompt nodes created on first canvas entry, so that unconfigured empty generation nodes are not created.
54. As an internal ecommerce designer, I want each reference-image node mapped one-to-one to its prompt node, so that clicking either one identifies the related item.
55. As an internal ecommerce designer, I want to select the product white-background image from the image resource library in the shared canvas, so that product truth comes from an existing managed asset.
56. As an internal ecommerce designer, I want white-background, generation-task, and result nodes added only after product binding, so that the canvas reflects real workflow state.
57. As an internal ecommerce designer, I want to create a new reverse-generation plan from the reverse workspace, so that a standalone workflow is supported.
58. As an internal ecommerce designer, I want to append reverse outputs to an existing suite as an independent task group, so that they can share the canvas without rewriting the suite plan.
59. As an internal ecommerce designer, I want appending reverse outputs to leave all existing suite cards and versions unchanged, so that prior work remains immutable.
60. As an internal ecommerce designer, I want the exact prompt version used by a generation task frozen, so that later prompt edits do not rewrite history.
61. As an internal ecommerce designer, I want to bind up to three product white-background images to one reverse prompt, so that additional angles and details reduce product-shape ambiguity.
62. As an internal ecommerce designer, I want the same white-background resource version reusable by multiple prompt cards, so that the canvas reflects shared product assets without copying them.
63. As an internal ecommerce designer, I want the white-background picker to support draft selection, preview, ordering, confirmation, and cancel, so that I can form a complete product asset set before creating a task version.
64. As an internal ecommerce designer, I want the original explosive reference image optionally sent with the product asset set, so that the image model can preserve layout and visual direction while white-background images remain the product-appearance truth.
65. As an internal ecommerce designer, I want one multimodal generation request to produce one result from the full input set, so that product angles are considered together rather than silently discarded.
66. As an internal ecommerce designer, I want changing the product asset set or explosive-reference switch to create a new task input version, so that old results remain traceable.
67. As an internal ecommerce designer, I want failed generation retries to reuse their frozen input version, so that retries are reproducible and distinguishable from new-input generations.
68. As an internal ecommerce designer, I want an explicit empty state when no white-background image is bound, so that generation cannot start without product truth.
69. As an internal ecommerce designer, I want generation blocked when the provider lacks required multi-image support, so that the canvas never claims inputs were used when they were silently dropped.
70. As an internal ecommerce designer, I want to inspect generated results manually, so that product fidelity and visual quality remain a human decision.
71. As an internal ecommerce designer, I do not want an automatic similarity score or pass/fail conclusion, so that an unvalidated machine judgment does not block production.
72. As a platform operator, I want reference originals and thumbnails stored as immutable objects, so that historical plans remain reproducible.
73. As a platform operator, I want temporary signed URLs excluded from business snapshots, so that stored history does not contain expired access data.
74. As a platform operator, I want provider credentials, request headers, and hidden templates excluded from browser responses and ordinary logs, so that secrets and proprietary prompts remain protected.
75. As a platform operator, I want idempotency on create, upload, reverse, retry, save, and canvas-import commands, so that repeated client requests do not create duplicate business records.
76. As a template maintainer, I want published reverse templates immutable, so that historical prompts always refer to the exact version used.
77. As a template maintainer, I want a reverse-specific template stage, so that reverse analysis is not disguised as suite planning or image generation.
78. As a developer, I want the feature to extend the current application, repository, provider, storage, and workbench boundaries, so that no parallel application stack is introduced.
79. As a developer, I want browser-visible behavior verified at 1440x1000 with no console errors or overlap, so that the desktop V1 matches the approved prototype structure.

## Implementation Decisions

### Source Authority

- The PRD is the authoritative product and scope source.
- The prototype is authoritative only for the desktop three-column composition, visible controls, interaction order, and compact result browsing.
- Prototype fixtures, generated sample prompts, local-only Toast behavior, and simulated statuses are not production contracts.
- Domain terms follow the project glossary: 爆品参考图, 反推模板, 反推提示词, 系列色彩基准, 爆品图反推资产, 产品白底图, 提示词快照.
- Existing accepted suite-planning ADRs remain unchanged. 爆品图反推 is not an additional suite-planning stage and must not mutate confirmed suite structure plans.

### Product Entry and Routing

- Replace the current “全能模式” entry in place with “爆品图反推”; do not keep a second legacy or reserved entry.
- Add one route and one desktop page inside the current application shell and navigation model.
- Preserve all unrelated mode buttons and routes.
- A reverse plan has one top-level mode: `main` or `detail`.
- Switching the top-level mode invalidates incompatible template selections and unsaved generated prompts. The UI must warn before applying the switch when work would be discarded.

### Frontend Interaction

- Use the approved three-column Operate layout.
- The left column owns top-level mode and plan-level commands.
- The center column owns upload, order, removal, per-image template selection, baseline selection, and per-image status.
- The right column owns the selected image, current template, complete prompt editor, save, regenerate, and copy.
- Keep the complete prompt out of every image card; cards remain scannable when 16 images are present.
- Do not add “apply template to all”, per-prompt confirmation states, machine scores, nested approval panels, or editable auxiliary prompt sections.
- The canvas entry command is enabled when at least one reference image has a succeeded prompt result.
- The UI may import all currently succeeded prompts; failed or pending items remain in the reverse plan.

### Domain and Persistence Model

- Introduce a reverse-plan aggregate rather than overloading a suite plan snapshot.
- The reverse plan stores its mode, status, timestamps, series color baseline reference, and optional target suite relationship.
- A reverse reference belongs to one reverse plan and stores immutable source metadata plus a mutable ordering position.
- A reverse reference has one current template-version selection and multiple reverse attempts.
- A successful reverse attempt creates an immutable prompt version containing the model output and request snapshot.
- Saving an edited prompt creates or updates a user-authored prompt version without changing earlier immutable versions.
- The plan points to the current effective prompt version for each reference.
- Archiving a reusable 爆品图反推资产 creates a resource-library record referencing the immutable reference and prompt snapshots.
- Historical prompt versions, attempts, archived assets, and canvas import snapshots are retained rather than physically deleted.
- PostgreSQL stores business relationships, statuses, template/version references, hashes, request summaries, prompt versions, canvas mappings, and audit data.
- MinIO stores reference originals, thumbnails, and any required previews. Object keys are immutable; temporary signed URLs are not persisted.

### Repository Boundaries

- Extend the existing repository pattern with one reverse-plan repository contract and matching memory/PostgreSQL implementations.
- Do not put reverse-plan persistence into the suite repository, plan repository, or task repository merely to avoid a new interface; those aggregates have different lifecycle ownership.
- Reuse the existing storage adapter for reference object writes, reads, previews, and cleanup after failed transactions.
- Reuse the existing library repository when a saved reverse result becomes a reusable resource.
- Reuse the existing task and canvas repositories only when importing results into a shared suite workbench.

### Prompt Template Contract

- Add `reverse_prompt` to the prompt-stage vocabulary.
- A reverse template declares `targetType` as `main` or `detail`, plus applicability, version, input schema, and output schema.
- Runtime selection accepts only published versions whose stage and target type match the reverse plan.
- Templates from `base_refine`, `plan`, and `task_image` are rejected for reverse-prompt execution even if their names or applicability metadata appear similar.
- Published versions remain immutable. Editing creates a new draft version that must be published before runtime use.
- Browser template listings expose name, version, applicability summary, and input requirements, but not the hidden System Prompt or full runtime body.
- Main V1 template families are: white-background product, scene, selling-point information, and promotion campaign.
- Detail V1 template families are: hero/brand, core selling point, lifestyle, detail close-up, size/specification, and promotion/trust.

### LLM Contract

- Extend the existing LLM adapter with a reverse-prompt operation instead of creating a second provider stack.
- A batch command orchestrates independent per-reference operations. It does not ask one model call to produce one merged prompt for the entire set.
- Main mode sends the current reference image with its selected template inputs.
- Detail mode sends the current reference image and, when different, the selected series color baseline image with explicit input roles.
- The baseline image is allowed to influence only color and lighting order.
- The LLM response must pass a versioned structured-output contract before persistence.
- The minimum result contract is:

```json
{
  "schemaVersion": "reverse-prompt-v1",
  "referenceImageId": "reference-id",
  "prompt": "完整中文生图提示词"
}
```

- Reject missing, blank, mismatched-reference, wrong-schema, or multi-result responses.
- Do not expose hidden model reasoning or internal template bodies.
- The final prompt text must remain executable with only product white-background input. During shared-canvas generation, the provider may additionally receive the original explosive reference image as an optional layout/style reference; it must not become product truth.
- Product identity has higher priority than transferred composition or style.
- Reference brands, logos, product-specific facts, claims, certifications, prices, and promotion copy are prohibited unless later supplied by approved product data.
- Model/provider parameters remain execution metadata rather than prose appended to the visual prompt.

### API Contract

- Follow the existing resource-oriented HTTP application boundary and `{ data }` / `{ error }` response envelope.
- Mutating commands require an idempotency key.
- Required operations are:
  - create and list reverse plans;
  - get a reverse plan aggregate;
  - upload, preview, reorder, and remove reference images;
  - set the top-level mode and series color baseline;
  - select a published template version per reference;
  - start a batch of independent reverse requests;
  - start or retry one reference request;
  - inspect attempt status and prompt versions;
  - save an edited prompt as the effective version;
  - archive a result as a reusable reverse asset;
  - import succeeded reference/prompt pairs into a new or existing shared workbench.
  - list selectable `base_image` resources for a shared-canvas picker;
  - confirm, replace, reorder, and remove up to three white-background references for one prompt task;
  - create a frozen generation-task input version from the confirmed prompt/material set;
  - start or retry one multimodal generation request and inspect current/history results.
- Long-running LLM operations return accepted status with stable attempt identifiers and are polled through status resources.
- Batch status is derived from child attempts and supports completed, partial, and failed outcomes.
- Error responses use stable codes and user-facing recovery messages.

### Status and Retry Behavior

- A reverse plan exposes only `draft` and `archived` as durable plan lifecycle states.
- Each per-reference attempt exposes `pending`, `running`, `succeeded`, or `failed`.
- A server restart must not silently convert persisted success into failure.
- Requests left `running` without recoverable execution ownership may follow the existing asynchronous recovery policy and become retryable failures.
- Retry creates a new attempt linked to the failed attempt; it does not rewrite the old record.
- One child failure does not delete, roll back, or rerun successful children.
- A generation retry reuses the failed attempt's frozen input version. Changes to prompt text, product-material set, order, generation parameters, or explosive-reference usage create a new input version instead.

### Shared XYFlow Integration

- Reuse the current shared workbench and canvas layout model; do not create a reverse-specific canvas implementation.
- Initial import includes all currently succeeded results and excludes pending or failed results.
- Initial import creates one reference node and one prompt node per imported result, with a stable mapping edge.
- The import stores the exact effective prompt version used.
- One idempotent import command records the target suite, imported reverse-plan results, effective prompt versions, independent task-group relationship, and persisted canvas node/edge mappings as one business operation.
- Reference nodes and prompt nodes support mutual selection/location.
- Product white-background images are selected later from the existing image resource library.
- White-background selection reuses the existing cross-suite library-reference mechanism. It does not copy the image, create a reverse-specific binding entity, or create a separate white-background snapshot system.
- The shared-canvas picker shows selectable `base_image` resources and keeps multi-select/order changes as local draft until confirmation.
- One prompt may bind one to three white-background resource versions; the same resource version may be referenced by multiple prompt cards.
- The canvas renders one shared node per resource version and maps it to each consuming generation task; removing one consumer does not remove the node while other consumers remain.
- Binding confirmed resources appends the product node(s) and enables downstream generation-task creation. Without a product material set, generation is disabled and no empty product node is created.
- A generation request sends the ordered product-material set, the current effective prompt, and the original explosive reference image when its switch is enabled. It produces one result per request.
- If the provider lacks the required multi-image capability, generation fails before dispatch with a stable recoverable error; the server must not silently drop images or synthesize a composite.
- Each confirmed material-set change creates a complete immutable task input version containing prompt version, resource IDs and versions, order, explosive-reference version/switch, and generation parameters.
- A task node exposes one current result and a history of prior results. After input changes, the current-result area reports that the input changed until the new version succeeds.
- Each generation task version records the exact white-background resource ID and immutable resource version used. Selecting a different white-background resource creates a new generation task version and leaves prior task versions unchanged.
- Generation uses the existing task, slot, attempt, image-version, current-version, and final-version semantics.
- Importing into an existing suite creates an independent task group and does not mutate the suite structure plan, existing plan items, tasks, prompt drafts, batches, or image versions.

### Resource Library Integration

- `reverse_reference_asset` remains a supported image-resource type.
- A reusable reverse asset includes the reference preview, source metadata, effective prompt snapshot, template-version reference, and reverse-plan provenance.
- The asset is not product evidence and must not be presented as approved product facts.
- Product white-background images remain a separate resource type and selection flow.
- Resource selection must never merge “prompt template” and “white-background image” into one concept or picker.

### Security and Privacy

- Provider credentials and Authorization headers remain server-only.
- Internal provider URLs, temporary signed URLs, hidden template bodies, and raw secret-bearing responses are excluded from browser payloads, business snapshots, and normal logs.
- Stored request summaries are allowlisted and redacted.
- Reference-image content is treated as externally sourced material; source/provenance can be recorded, but the system does not assert commercial usage rights.
- Generated prompts must not imply that an open-source case repository grants rights to referenced products, brands, people, or designs.

### Migration and Compatibility

- Add new schema and migrations without rewriting existing suite, plan, task, prompt, or library history.
- Existing “全能模式” has no business records to migrate; only its visible entry is replaced.
- Historical suite workbench routes and plans remain readable and behaviorally unchanged.
- Existing prompt stages remain valid; `reverse_prompt` is additive.
- Adding `reverse_prompt` must not change the runtime meaning or accepted targets of `base_refine`, `plan`, or `task_image`.
- Existing resource records remain valid; reverse assets use the current library lifecycle and preview mechanisms.

### Completion Gate

- This specification is confirmed for implementation.
- The implementation must preserve the V1.1 multi-image product-material contract, optional explosive-reference input, shared canvas resource reuse, immutable task input versions, and explicit provider capability failures.

## Testing Decisions

### Primary Test Seam

- The primary automated seam is the existing application-level HTTP request boundary with memory repositories, memory storage, published prompt fixtures, and a deterministic fake LLM.
- Tests drive public commands and queries exactly as the frontend would, wait for terminal attempt state, and assert returned aggregate behavior plus durable repository state.
- This is the highest practical seam before a real browser: it verifies routing, validation, idempotency, orchestration, persistence, failure isolation, retry relationships, snapshots, and response redaction without coupling tests to internal helper functions.
- Do not create separate unit tests for every handler, mapper, or repository call when the same behavior is observable through this seam.

### Browser Acceptance Seam

- Use a real desktop browser against the running application for user workflow acceptance.
- Required viewport is 1440x1000 because V1 is desktop-only and the approved prototype was verified at that size.
- Browser acceptance covers entry replacement, route loading, mode switching, upload, 16-image scrolling, deletion, drag ordering, per-image template selection, baseline selection, batch start, partial failure, single retry, prompt editing, save, copy, refresh restoration, and shared-canvas import.
- Capture screenshots of the reverse workspace and the imported XYFlow nodes.
- Assert no unhandled page errors, console errors, incoherent overlap, or horizontal overflow.

### Contract Tests

- Test the `reverse-prompt-v1` output schema independently with valid and invalid provider responses.
- Test stage/target applicability: main plans cannot use detail templates, detail plans cannot use main templates, and non-`reverse_prompt` templates are rejected.
- Test prompt safety rules at the contract boundary using deterministic fixtures for forbidden brand/fact transfer and product-appearance invariants.
- Test API error codes and status transitions without asserting internal function names or SQL statements.

### Repository Tests

- Memory and PostgreSQL repository implementations must pass the same behavioral contract for:
  - plan creation and retrieval;
  - reference ordering and removal;
  - duplicate/hash rules;
  - attempt creation, terminal transition, and retry links;
  - immutable prompt versions and current-effective selection;
  - series color baseline selection;
  - archive resource creation;
  - canvas import idempotency.
- Database tests assert externally meaningful persistence and constraints, not exact query text.

### Required Behavioral Cases

- Replacing the visible “全能模式” entry leaves no old entry or reserved-state copy.
- Creating a reverse plan is idempotent.
- Uploading one supported image succeeds.
- Uploading 16 supported images succeeds.
- Uploading a seventeenth image fails without creating storage or database residue.
- Unsupported or invalid image content fails with a recoverable message.
- A duplicate upload follows the declared duplicate policy and does not create duplicate business records.
- Reordering references changes order deterministically and survives refresh.
- Reordering does not regenerate or overwrite existing prompt versions.
- Mode switching with no generated work succeeds.
- Mode switching with incompatible generated work requires an explicit destructive confirmation.
- Every reference selects one compatible published template version.
- A `base_refine`, `plan`, or `task_image` template is rejected by reverse-plan execution.
- A batch with N eligible references creates N independent attempts.
- One failed child produces a partial batch while successful prompts remain available.
- Retrying one failed reference creates one linked attempt and does not rerun successful references.
- Missing LLM configuration returns an explicit service error and creates no fake prompt.
- LLM timeout persists a retryable failure.
- Invalid structured output creates no successful prompt version.
- A response for the wrong reference ID is rejected.
- A valid response freezes reference, mode, baseline, template version, provider summary, and raw output.
- Saving edited text creates an effective user prompt version without altering the model-output version.
- Regeneration preserves previous prompt history.
- Copy returns the current editor text, including unsaved edits if that is the visible behavior selected by the frontend.
- Changing a detail baseline affects only later or explicitly regenerated prompts.
- Archiving creates a reusable reverse asset with provenance and no product-fact semantics.
- Importing succeeded outputs creates one reference node, one prompt node, and one mapping edge per result.
- Pending and failed outputs remain in the reverse plan and do not create canvas nodes.
- Repeating the same import command is idempotent.
- Importing into an existing suite does not change existing tasks, prompts, batches, or versions.
- Selecting a white-background resource occurs in the shared canvas, not in the reverse upload page.
- Selecting a white-background resource creates a cross-suite resource reference without copying the image or creating a separate binding record.
- The shared-canvas picker supports 1–3 white-background resources per prompt, ordering, preview, confirmation, and cancel without persisting unconfirmed drafts.
- One white-background resource version can be reused by multiple prompt cards; the canvas renders one shared resource node with multiple mappings.
- The generation task input version records the ordered resource IDs and immutable versions, the effective prompt version, explosive-reference version/switch, and generation parameters.
- The generation request sends the complete product-material set and, when enabled, the explosive reference image as a layout/style reference; one request produces one result.
- Provider lack of multi-image support blocks generation with a recoverable error and never silently drops or composites inputs.
- Selecting, removing, reordering, or replacing white-background resources, or changing the explosive-reference switch, creates a new task input version; prior task versions and results remain unchanged.
- A task node exposes one current result and prior results in history; after input changes, the current state reports that a new result is pending.
- A failed generation retry reuses the failed attempt's frozen input version.
- Historical generation tasks retain the prompt version frozen at task creation.
- API responses do not expose hidden template bodies, provider secrets, Authorization values, or temporary signed URLs.

### Prior Art

- Follow the existing contract-test style that builds the application with memory repositories and deterministic provider fakes, calls the public HTTP-style request boundary, waits for asynchronous attempts, and verifies both API output and persisted snapshots.
- Follow the existing idempotency, immutable snapshot, partial-batch, retry, storage cleanup, and missing-object behavior already used by suite planning and task generation tests.
- Follow the existing Playwright/browser evidence pattern for desktop workbench controls, canvas behavior, overflow, and console checks.

### Test Quality Rules

- Assert user-observable behavior and durable contracts, not component state variables, private helper functions, SQL text, or exact DOM nesting.
- Use deterministic fake LLM responses for automated tests; do not spend paid provider calls in the test suite.
- Keep one narrowly authorized real-provider smoke test separate from deterministic CI, using non-sensitive fixtures and redacted evidence.
- Use real image bytes for upload and preview boundary tests; do not claim image handling works from metadata-only fixtures.
- Verify redaction by scanning values, not only key names.
- Do not mark the feature complete from typecheck and unit tests alone; completion requires build, HTTP contract tests, browser acceptance, persistence verification, and secret scans.

## Out of Scope

- Preserving or rebuilding a generic “全能模式”.
- Mobile or tablet-specific UI.
- Uploading the user’s product original or white-background image on the reverse page.
- Generating product images directly on the reverse page.
- A separate reverse-only canvas or generation engine.
- Automatic merging of multiple reference images into one composite prompt.
- Applying one template to all reference images.
- Automatic classification that forces a main/detail template without designer selection.
- Image cropping, stitching, slicing, background removal, retouching, or pixel editing.
- ControlNet, Canny, depth, pose, segmentation, line-art, or other provider-specific structural controls.
- Masked editing or regional repainting in this feature.
- Machine product-fidelity scoring, similarity scoring, automated pass/fail, or automated approval.
- Complex per-prompt approval workflows, confirmation states, or bulk approval gates.
- Copying reference brands, logos, prices, parameters, certifications, claims, or promotion text as product truth.
- Product-material upload, cleansing, fact maintenance, RAG ingestion, or upstream data review.
- Modifying existing suite structure-plan semantics or accepted two-stage suite-planning ADRs.
- Replacing existing task/image-version history with a new version model.
- Direct publishing to ecommerce platforms.
- Multi-user realtime editing.
- General prompt-marketplace redesign.
- Remote production deployment as part of this specification.

## Further Notes

- The approved prototype is a functional and information-architecture baseline, not a final visual contract.
- Formal UI should inherit the existing PicAgent desktop design system, navigation, icons, density, and controls.
- The PRD currently asks template selection to show version, applicability, and input requirements; the static prototype mainly shows the template name. The formal implementation follows the PRD/spec requirement.
- The static prototype simulates prompt generation locally. Production uses the versioned server template and LLM contracts described above.
- Saving a prompt is the user action that makes the edited prompt effective; there is intentionally no separate “confirmed” state.
- “人工校验” means the designer judges generated output in the shared canvas. It does not add another persisted approval state in V1.
- Source and authorization risk remain separate from visual reverse engineering. A reference image can inform composition without granting commercial rights to its brand, product, person, or artwork.
- The repository remote is Gitee, but no issue-tracker integration or `ready-for-agent` label vocabulary is configured in this workspace. This specification is therefore written as a local project document and has not been published to an external issue tracker.

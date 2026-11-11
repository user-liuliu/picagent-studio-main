# 套图工作台 V1.1 分层套图规划技术规格

> 状态：待实现确认
> 日期：2026-08-25
> 依据：`docs/PRD-套图工作台-V1.1-分层套图规划.md`、`docs/adr/0001-two-phase-suite-planning.md`

## Problem Statement

当前套图计划把设计师输入、系统提示词、全部商品资料和图片一次性发送给 QWEN，要求模型直接返回整套图片的最终卡片提示词。当图片数量较多时，模型需要同时处理主图、详情图、场景、卖点、细节、尺寸等不同职责，导致单条提示词过短、职责重复、商品事实引用不足和画面描述不准确。

当前实现还存在三个技术缺口：

- 计划输出只有 `main/detail` 两类，不能表达详情图类别和类别数量分配；
- 全局风格卡只在前端预览层拼接，未必进入真实生图请求和提示词快照；
- 旧 `plan` 模板以一次请求直接产出最终卡片为目标，不能直接作为 V1.1 模板写入 PostgreSQL。

## Solution

将套图计划拆成两个 QWEN 阶段，并保留现有一张卡一次生图的底层规则。

第一阶段 `structure_plan` 只负责图片结构计划：主图数量、详情图最终总数、已选详情图类别的数量分配、类别采用理由、参考图、事实依赖、缺失事实和全局风格卡草案。服务端对数量、类别、事实来源和参考图关系做确定性校验。

设计师在结构计划审核界面修改并明确确认。未确认的结构计划不得进入第二阶段。

第二阶段 `category_prompt` 按类别分别请求 QWEN。主图使用 `main` 类别；详情图使用具体 `detailCategory`。每次请求只处理一个类别，并返回该类别确认数量对应的独立完整提示词。每条提示词物化为一个最终计划项和一张任务卡。

真实生图时，完整 prompt 按以下顺序组合并冻结：

1. 系统安全、平台合规和商品事实约束；
2. 已确认的全局风格卡；
3. 当前类别提示词；
4. 当前单卡人工补充。

生图 provider 继续固定 `n=1`。首次批量生成保持 `N 个任务 -> N 张首图`，单卡重新生成只新增一张历史版本。

## User Stories

1. As a 设计师, I want to upload 1–6 张同一商品的原始图片, so that QWEN can use multiple views to preserve the product's true appearance.
2. As a 设计师, I want to set a definite main-image count, so that the expected number of main-image cards is predictable.
3. As a 设计师, I want to set a fixed detail-image total or a detail-image range, so that I can control workload while allowing QWEN to optimize the distribution.
4. As a 设计师, I want to select the detail-image categories that may participate in planning, so that QWEN cannot add unrelated image types.
5. As a 设计师, I want to mark each selected category as required or optional, so that essential categories cannot silently disappear while unsuitable categories may be omitted.
6. As a 设计师, I want to provide product facts, selling points, parameters, usage scenarios and restrictions, so that generated prompts use known facts instead of guesses.
7. As a 设计师, I want to select and freeze relevant RAG Chunks, so that only approved source material enters the planning request.
8. As a 设计师, I want to choose a platform profile, so that category priorities, text-overlay rules and platform constraints influence planning.
9. As a 设计师, I want QWEN to propose a structure plan before writing final prompts, so that I can review the composition of the whole suite.
10. As a 设计师, I want to see the suggested main-image count and final detail-image total, so that I can judge the scope before prompt generation.
11. As a 设计师, I want to see each category's suggested count and reason, so that I can understand why the suite includes or omits a category.
12. As a 设计师, I want to see which original or current base image each category uses, so that I can correct an unsuitable reference before prompt generation.
13. As a 设计师, I want to see the facts required by each category, so that missing dimensions, accessories or compatibility facts are visible before generation.
14. As a 设计师, I want required categories with missing facts to block progression, so that the system never fabricates unsupported product claims.
15. As a 设计师, I want optional categories with no reliable facts to be assigned zero with a reason, so that the system does not create low-confidence images just to fill a quota.
16. As a 设计师, I want the system to reject a structure plan whose category counts do not sum to the final detail total, so that the plan remains mathematically consistent.
17. As a 设计师, I want to edit the final detail total and category counts, so that I can adjust the suite to business priorities before incurring category prompt requests.
18. As a 设计师, I want to edit required/optional relationships, so that I retain control over which image responsibilities are mandatory.
19. As a 设计师, I want to edit the global style card, so that all generated cards share one coherent visual direction.
20. As a 设计师, I want to confirm the structure plan explicitly, so that the system has a clear boundary between planning and prompt generation.
21. As a 设计师, I want confirmed structure-plan revisions to be immutable, so that later template changes do not alter the historical planning context.
22. As a 设计师, I want main images to receive independent prompts in a dedicated `main` category request, so that multiple main images have different responsibilities and compositions.
23. As a 设计师, I want each detail category to receive its own focused QWEN request, so that the model can describe that category in depth instead of compressing all categories into one response.
24. As a 设计师, I want a category request with count N to return N independent prompts, so that each resulting card has a distinct execution brief.
25. As a 设计师, I want category prompt generation to use only relevant facts and references, so that irrelevant context does not dilute the prompt.
26. As a 设计师, I want the category prompt to include the confirmed global style card, so that category-specific composition remains visually consistent with the suite.
27. As a 设计师, I want text-overlay permission to follow platform rules, so that QWEN cannot introduce prohibited text into an image.
28. As a 设计师, I want text content to be traceable to approved facts or my own input, so that image text does not invent unsupported claims.
29. As a 设计师, I want a failed category request to remain visible with its reason, so that I know what needs correction or retry.
30. As a 设计师, I want to retry one failed category without regenerating successful categories, so that a local failure does not waste completed prompt work.
31. As a 设计师, I want a category response with the wrong number of items to fail validation, so that incomplete prompt sets do not become incomplete task cards.
32. As a 设计师, I want the system to avoid infinite automatic retries, so that provider failures remain bounded and understandable.
33. As a 设计师, I want successful category prompts to become independent task cards, so that I can inspect and edit each image responsibility.
34. As a 设计师, I want task cards to show category, responsibility, references and prompt snapshots, so that every card is explainable.
35. As a 设计师, I want the actual image-generation prompt to include the global style card, so that the generated image matches the previewed style rather than only the UI display.
36. As a 设计师, I want the final prompt and its hash frozen with each image version, so that historical images remain reproducible and auditable.
37. As a 设计师, I want the existing N-to-N first-generation rule to remain, so that the number of initial images equals the number of task cards.
38. As a 设计师, I want one-card regeneration to create one new version, so that previous results remain available for comparison.
39. As a 设计师, I want a refreshed page to restore structure-plan, category-request and card states from the server, so that browser memory is not the source of truth.
40. As a 设计师, I want old V1 plans and images to remain readable, so that the V1.1 rollout does not rewrite historical production records.
41. As a 提示词维护者, I want old one-shot templates preserved as historical versions, so that existing snapshots remain attributable to the template that created them.
42. As a 提示词维护者, I want new `structure_plan` and `category_prompt` templates to be versioned and published separately, so that their input/output contracts cannot be confused.
43. As a 提示词维护者, I want template publication to validate stage, input schema and output schema together, so that unsuitable content cannot be imported into PostgreSQL.
44. As a 系统, I want category requests to be idempotent, so that client retries do not issue duplicate QWEN calls.
45. As a 系统, I want category request status and response summaries persisted, so that partial success and manual retry are recoverable.
46. As a 系统, I want sensitive data excluded from archives, logs and client responses, so that API credentials, temporary URLs and raw base64 are not exposed.

## Implementation Decisions

### Planning stages and templates

- Add two published prompt stages: `structure_plan` and `category_prompt`.
- Keep the old one-shot `plan` templates as historical versions; do not mutate them in place.
- Add `general.structure-plan` as the first-stage template.
- Add one generic `general.category-prompt` template initially. Pass category-specific rules as structured configuration. Split a category into a dedicated template only after measured quality evidence.
- Rewrite the new template bodies from proven SOP rules. Keep product-lock, factuality, platform compliance, text readability and global-style rules. Remove one-shot output instructions, fixed module lists, Markdown output examples and unsupported comparison, promotion or efficacy directions.
- Do not publish/import a template when its stage, `inputSchema`, `outputSchema` or body still describes the old one-shot `main/detail` contract.

### Structure-plan input contract

The first-stage input keeps product, platform, language, brand, selling-point, parameter, audience, usage, positioning, style and forbidden-content fields. It adds:

- `main_image_count` as a positive definite integer;
- `detail_image_count_min` and `detail_image_count_max` as positive bounds with `min <= max`;
- `selected_detail_categories` containing only supported category codes;
- `category_requirements` mapping selected codes to `required` or `optional`.

The old `output_mode`, `main_image_count_mode`, `detail_image_count_mode` and single ambiguous `detail_image_count` fields are not part of the V1.1 structure-plan contract. A fixed detail total is represented by equal min and max values.

### Structure-plan output contract

The output is a versioned structure plan containing:

- status and `canProceed`;
- proposed main-image count;
- final detail-image count and the accepted range;
- one allocation entry per selected category;
- adoption decision and reason;
- required and missing facts;
- selected original/base image references;
- global style-card draft.

The service validates category membership, required/optional rules, count range, sum equality, positive main count, reference ownership and fact-source eligibility before persisting a snapshot.

### Confirmation and revision

- A structure plan remains editable while `draft` or `needs_human_input`.
- Confirmation creates an immutable confirmed revision.
- Changing categories, count range, requirement mode or invalidating allocations creates a new revision and requires re-confirmation.
- Category prompt generation is rejected unless a valid confirmed revision exists.

### Category-prompt input and output

Each category request receives only:

- the confirmed structure-plan revision;
- the current category code and confirmed count;
- universal product appearance-lock facts;
- category-specific approved facts and frozen RAG Chunk content;
- category reference images or current base versions;
- confirmed global style card;
- applicable platform text/compliance rules;
- designer category-level additions.

The output uses `suite-category-prompt-v1` and contains one `items` array for exactly one `categoryCode`. Each item contains a stable ID, title, purpose, reference IDs, fact references, text-overlay decision, text content/source, ratio, generation parameters and a complete prompt. The service rejects wrong category codes, wrong item counts, new categories, changed style cards and unsupported fact references.

### Prompt composition and image generation

- Store the category prompt as a category-level snapshot.
- Compose the actual image-generation prompt in the fixed order: system safety/platform/fact constraints, confirmed global style card, category prompt, single-card manual addition.
- Store the composed prompt and hash in the task and image-version snapshots.
- Continue to call the image provider with `n=1`.
- Continue to create one result slot per task for first generation and one new slot per single-card regeneration.

### API surface

Reuse the suite `/plan` resource boundary. The minimal operations are:

- create a structure-plan attempt;
- save a human structure-plan revision;
- confirm a structure-plan revision;
- start category-prompt generation for a confirmed revision;
- read category-prompt batch/category status;
- retry one failed category request.

Existing task-card generation, version selection, retry and preview operations remain the image-generation boundary.

### Async execution, idempotency and recovery

- Reuse the current server-side asynchronous execution model; do not add a new queue, worker process, lease or heartbeat for V1.1.
- Persist a running category request before calling QWEN.
- Use a stable idempotency key scoped to the suite, confirmed structure-plan revision, category and request attempt.
- Run category requests serially initially. Successful categories materialize cards immediately; failed categories remain independently retryable.
- On process restart, follow the existing running-attempt recovery policy and mark stale running category requests failed for manual retry. Automatic requeue is out of scope.

### PostgreSQL model

Keep immutable structure-plan data in the existing plan snapshot version chain, adding confirmation state and a structure JSON snapshot. Add one category-request record per logical category request with:

- parent structure-plan snapshot ID;
- category code (`main` for main images);
- requested count;
- status;
- idempotency key;
- retry-of request ID;
- provider/model and request summary;
- response summary and sanitized error fields;
- created/completed timestamps.

Do not add a separate category-batch table in V1.1; aggregate category records under the confirmed structure-plan revision to compute batch status. Successful items continue into the existing plan-item/task-card materialization path, with detail category and final prompt snapshot fields added.

### Provider and archive boundary

- Extend the LLM client boundary to accept stage-specific requests while reusing timeout, JSON parsing, request archiving and sanitized error handling.
- Archive stage, template version, category code, request ID, input references and sanitized response summary.
- Never archive API keys, authorization headers, raw data URLs, permanent object URLs or unbounded raw provider payloads.

### Frontend state

- Add a structure-plan review state between first-stage completion and creation-board navigation.
- Show count allocations, required/optional state, reasons, missing facts, references and global style card editing.
- After confirmation, show category-level prompt progress and retry controls.
- Group/filter task cards by `main` or detail category and show the final prompt snapshot.
- Treat server responses as the source of truth after refresh.

## Testing Decisions

Tests assert external behavior and persisted contracts, not React component internals or provider-specific response shapes. Use fake RAG, fake LLM, fake image provider and in-memory repositories for fast contract tests; use PostgreSQL/MinIO integration tests only where transaction and object ownership behavior matters.

### Primary API seam

Extend the existing application-level contract seam to cover:

- structure-plan request and 202/running state;
- invalid count/category/fact rejection;
- immutable structure-plan snapshot creation;
- human revision and confirmation gate;
- category batch start and category-level status;
- wrong-count failure and single-category retry;
- successful prompt materialization into task cards;
- global-style prompt composition and snapshot hashing.

### Prompt/template seam

Test the prompt repository and LLM client boundary for:

- stage isolation between `structure_plan`, `category_prompt`, `base_refine` and `task_image`;
- input schema defaults and removal of obsolete fields;
- category-focused request content;
- correct stage/category/schema in archived requests;
- no credentials, raw base64 or temporary URLs in archives;
- structured JSON parsing and sanitized provider failures.

### Persistence seam

Test PostgreSQL contracts for:

- immutable confirmed structure-plan revisions;
- category-request uniqueness and idempotency;
- retry relationship and status transitions;
- aggregation of partial/succeeded/failed category states;
- task-card materialization without duplicate cards;
- preservation of old plan snapshots and image versions.

### Browser seam

At desktop viewport 1440x1000, verify:

- configure and submit a structure plan;
- edit and confirm allocation;
- view missing facts and references;
- start category prompt generation;
- observe partial success and retry one failed category;
- inspect global style card and task-card prompt;
- start N-to-N image generation and one-card regeneration;
- refresh during running/partial states and recover from server state.

### Prior art

Reuse the existing plan contract tests for asynchronous 202 responses, selected Chunk freezing, timeout/schema failures and immutable snapshots. Reuse task-generation contract tests for idempotency, one-slot-per-task, failure preservation, retry behavior and immutable image versions. Reuse prompt-library lifecycle tests for draft/copy/publish/retire and stage filtering.

## Out of Scope

- Rewriting or deleting historical V1 templates, plans or images.
- A new queue, independent worker service, lease/heartbeat system or automatic stale-request requeue.
- Per-category bespoke templates before measured quality evidence justifies them.
- Automatic fact extraction or RAG data mutation.
- Unsupported competitor comparisons, before/after claims, efficacy proof, promotions or unverified text overlays.
- Mobile UI, video, 360-degree output, 3D models, platform publishing and multi-user collaboration.
- Real third-party QWEN or image-provider smoke tests by default.
- Publishing to an external issue tracker until this repository's issue-tracker configuration is established.

## Further Notes

- The old V1 PRD remains historical. V1.1 is an independent implementation contract and must not silently alter the old V1 semantics.
- The existing normalized one-shot plan template is known to be unsuitable for V1.1. Template source, schemas and stage metadata must be corrected and published before PostgreSQL import.
- The initial implementation intentionally accepts the current process-local async limitation: a process restart can leave no automatic requeue. This is an explicit V1.1 boundary, not a claim of durable worker recovery.
- No business code was changed while producing this specification.

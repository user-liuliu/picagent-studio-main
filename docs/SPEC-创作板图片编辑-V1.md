# 创作板图片编辑 V1 工程规格

> 状态：实施中
> 日期：2026-08-31
> 依据：创作板图片编辑 V1 PRD、ADR 0003

## Problem Statement

设计师需要在套图工作台的创作板中对已生成图片进行可追溯的模型编辑。当前编辑动作、图片位置、蒙版、OCR 文字块、版本选择和父子卡片关系没有统一的端到端工程契约，容易出现只保存自然语言、坐标错位、重复子卡片、失败记录丢失、重试产生错误血缘，以及再次生成错误使用最终版等问题。

## Solution

建立一个由编辑器草稿驱动、在生成时冻结的图片编辑工作流：Konva + react-konva 负责内层图片编辑，XYFlow 负责外层任务卡与子卡片关系；业务层维护框架无关的 `EditOperation`、不可变 `EditSnapshot` 和稳定 `ImageEditCommand`；`OcrProvider` 与 `ImageEditProvider` 通过能力矩阵明确支持范围。

一次编辑会话可以组合多个有顺序的操作，但一次提交只创建一个 child task、一张子卡片、一个冻结快照和首个 generation attempt。再次生成只在同一卡片下创建新图片版本。所有坐标以来源图片版本为基准，失败和重试保留完整血缘并保证幂等。

## User Stories

1. As a 设计师, I want to open an image from the creation board in an editing state, so that I can modify the exact image version I selected.
2. As a 设计师, I want to see exactly seven V1 editing tools, so that unavailable features do not appear to be supported.
3. As a 设计师, I want to revise the prompt of the opened image, so that I can request a semantic image change.
4. As a 设计师, I want to regenerate the same task card, so that I can compare new versions without creating a child card.
5. As a 设计师, I want regeneration to use the current version, so that the version I am actively reviewing is the generation source.
6. As a 设计师, I want to switch a historical version to current before regenerating, so that regeneration starts from that historical version.
7. As a 设计师, I want to add new text to an image, so that text absent from the source image is represented as a structured text operation.
8. As a 设计师, I want to move, resize, rotate and style added text, so that the model receives the intended placement and appearance.
9. As a 设计师, I want to change existing text after OCR recognition, so that the original text can be replaced rather than merely covered.
10. As a 设计师, I want OCR results to include confidence, bounds and rotation, so that I can choose the correct text block.
11. As a 设计师, I want OCR failure to remain a change-text operation, so that I can retry recognition or manually select the original text region.
12. As a 设计师, I want to paint a region for local redraw, so that only the selected area is regenerated.
13. As a 设计师, I want to paint a region for erase, so that the model removes content and repairs the surrounding background.
14. As a 设计师, I want undo, redo, clear and brush-size controls for masks, so that I can correct selection mistakes before submission.
15. As a 设计师, I want to expand an image by a supported direction and target ratio, so that the model extends the canvas without arbitrary pixel configuration.
16. As a 设计师, I want to see the outpainting area as a transparent checkerboard, so that I understand which area will be generated.
17. As a 设计师, I want to combine text, redraw and outpainting in one editing session, so that related changes can be submitted together.
18. As a 设计师, I want each operation to have an operation ID and order, so that combined edits remain auditable and replayable.
19. As a 设计师, I want to add an operation to the conversation without triggering generation, so that I can continue editing before submission.
20. As a 设计师, I want later canvas changes to update the conversation operation, so that the submitted structure matches the latest draft.
21. As a 设计师, I want repeated add-to-conversation actions to update the same operation, so that duplicate operation entries are not created.
22. As a 设计师, I want to remove an operation from the conversation, so that I can submit only the changes I still want.
23. As a 设计师, I want to edit the natural-language summary, so that I can make the model instruction clearer without losing structured fields.
24. As a 设计师, I want invalid or incomplete structured operations to block generation, so that a missing mask or source version cannot produce an ambiguous request.
25. As a 设计师, I want one combined submission to create one child card, so that the card graph represents submissions rather than individual UI actions.
26. As a 设计师, I want each child card to show its source card, source version, operation summary and generation status, so that I can understand how it was produced.
27. As a 设计师, I want the first successful version to become current but not final, so that delivery selection remains an explicit design decision.
28. As a 设计师, I want to choose a final version explicitly, so that only my selected version is delivered.
29. As a 设计师, I want the gallery to fall back to current when no final version exists, so that an otherwise usable task is still visible.
30. As a 设计师, I want a failed or running version to be ineligible for final selection, so that incomplete results cannot be delivered.
31. As a 设计师, I want parent and child cards to maintain independent current and final versions, so that selecting a child result does not alter its parent.
32. As a 设计师, I want editing from history to record the exact opened version as parentVersionId, so that lineage matches my actual source.
33. As a 设计师, I want a child card to appear at submission time, so that pending and failed work remains visible.
34. As a 设计师, I want a failed child card to retain its error, so that I can diagnose and retry it.
35. As a 设计师, I want retry to reuse the same child card and snapshot, so that retry does not create duplicate branches.
36. As a 设计师, I want repeated requests with the same idempotency key to return the original operation and child card, so that client retries are safe.
37. As a 设计师, I want no image version to be created for a failed attempt, so that image history never contains a fabricated result.
38. As a 设计师, I want a provider capability state when opening a tool, so that I know whether the selected operation is available.
39. As a 设计师, I want capability checks to run again before generation, so that stale provider state cannot create an unsupported request.
40. As a 设计师, I want unsupported mask, text-region or outpainting requests to be blocked explicitly, so that structured intent is not silently flattened into a prompt.
41. As a 设计师, I want OCR to be independently retriable, so that recognition failure does not require abandoning the edit session.
42. As a 设计师, I want the OCR snapshot tied to the exact source version, so that recognition results cannot be applied to a different image.
43. As a 设计师, I want image-edit provider and capability versions recorded in the generation snapshot, so that results remain explainable after provider changes.
44. As a 设计师, I want the system to use stable image-edit commands, so that vendor-specific request formats do not leak into product behavior.
45. As a 设计师, I want coordinates to remain stable across browser zoom, pan and contain/cover display changes, so that masks and text land on the intended source pixels.
46. As a 设计师, I want expanded images to establish a new coordinate system, so that later edits align with the new image version.
47. As a 设计师, I want masks to be reproducible as same-sized grayscale PNGs, so that provider input aligns exactly with the source image.
48. As a 设计师, I want the system to preserve normalized strokes and mask metadata, so that edits can be reopened and audited without relying on Konva internals.

## Implementation Decisions

- Use XYFlow for the outer creation board and Konva + react-konva for the inner image editor.
- Persist only framework-independent `EditOperation` and immutable `EditSnapshot`; never persist Konva Stage JSON, private node types or node IDs.
- Keep the editor draft mutable until generation; freeze the complete snapshot at generation time.
- Model each submission as one ordered operation set, one child task, one child card and one or more attempts.
- Keep `currentVersionId` and `finalVersionId` as independent selections on every task card.
- Implement regeneration as same-task version creation, sourced from current version and never from final selection by default.
- Implement OCR through an independent `OcrProvider`; preserve `change_text` after OCR failure.
- Implement generation through `ImageEditProvider` capabilities for image-to-image, mask redraw, erase, exact text change, add text and outpainting.
- Run capability checks when opening tools and immediately before generation; unsupported structured operations fail before child task and attempt creation.
- Use a stable `ImageEditCommand` at the business boundary and keep vendor request mapping inside the provider adapter.
- Define all persisted rectangles in normalized source-version coordinates with top-left origin; normalize brush width against the source short edge and inverse display transforms before submission.
- Generate same-dimension single-channel grayscale masks where black means unchanged and white means editable; persist normalized strokes in the database and generated PNG metadata/object in MinIO.
- For outpainting, support only the agreed direction and ratio sets, calculate target dimensions automatically, save anchor and resulting dimensions, and create a child card.
- Treat failure as a retained child-card/attempt state with no image version; retries reuse the frozen snapshot and append attempts only.
- Enforce idempotency on submission so repeated keys return the original operation and child task.
- Keep detailed API fields, schema migrations and concrete provider vendor mappings for a later TECH-SPEC after the PRD development gate passes.

## Testing Decisions

- The highest seam is the creation-board image-edit application service. It accepts an editor draft and produces a frozen snapshot, child task, attempt or an explicit rejection.
- Application-service tests use fake `OcrProvider`, `ImageEditProvider`, repository and MinIO ports. They assert external behavior and persisted lineage, not private implementation details.
- Contract tests cover operation ordering, source-version binding, normalized coordinates, inverse display transforms, mask metadata, current/final transitions, idempotency, retries, failure retention and provider rejection.
- Browser tests cover the editor-to-dialogue seam: text movement, mask drawing, outpainting preview, repeated add-to-conversation updates, operation removal and payload synchronization.
- Browser assertions must inspect framework-independent payloads and visible behavior, not Konva Stage JSON or private node IDs.
- Integration tests cover transaction boundaries: capability failure creates no child task/attempt; accepted submission creates one child task and one frozen snapshot; successful attempts create versions only after object persistence.
- Prior art is the existing task generation contract, client idempotency, image-version selection and desktop browser acceptance tests in this repository.
- Real third-party calls remain out of default tests; deterministic fakes are required unless a separately authorized smoke test is requested.

## Out of Scope

- 超清、智能超清、画面微调 and any brightness/contrast/saturation/temperature/sharpness controls.
- Browser-local pixel-level final compositing.
- Mobile editing, real-time collaboration, professional layer blending, filter marketplace and direct ecommerce publishing.
- Automatic OCR-to-add-text conversion or pretending that overlaid text is a successful text replacement.
- Silent provider fallback from structured editing to ordinary prompt-only generation.
- Concrete provider vendor selection, API migration details and database migration implementation before the development gate.

## Further Notes

1. The PRD and ADR have passed the user-confirmed development gate; implementation is now in progress against this specification.
2. The repository has no configured external issue tracker or `ready-for-agent` vocabulary, so the ticket publication target is local `.scratch` files.
3. Ticket granularity and blocking edges must be approved before local ticket files are treated as ready for agent work.
4. This specification is the engineering handoff for the confirmed implementation.

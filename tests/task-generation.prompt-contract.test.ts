import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { createTicket02App } from "../server/app.js";
import { MemoryPlanRepository } from "../server/repositories/memory-plan-repository.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import { parsePromptMarkdown } from "../server/prompt-library.js";
import type { LlmClient, RagChunk } from "../server/types.js";

test("plan generation sends template, user input, selected chunks, and image ids to the LLM", async () => {
  const suites = new MemorySuiteRepository();
  const prompts = new MemoryPromptRepository();
  const plans = new MemoryPlanRepository();
  const storage = new MemoryStorage();
  const [template] = await prompts.importRecords(parsePromptMarkdown(
    "## 验证计划\n\n```text\n- 商品名称（必填）：\n```",
    "ticket08.md",
  ));
  await prompts.publishVersion(template.templateVersionId);
  const suite = await suites.createSuite("Ticket 08 prompt audit");
  const imageBytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: "white" } }).png().toBuffer();
  const calls: Array<Parameters<NonNullable<LlmClient["generatePlan"]>>[0]> = [];
  const app = createTicket02App({
    repository: suites,
    storage,
    promptRepository: prompts,
    planRepository: plans,
    ragClient: {
      async search() { return [{ id: "chunk.product", version: "1", title: "产品资料", summary: "白色包装", content: "白色包装，纸盒结构", fieldValues: { product_name: "白色包装" }, sourceKind: "fake", sourceAssetPaths: [], contentSha256: "c".repeat(64), published: true } satisfies RagChunk]; },
      async getByIds(refs) { return refs.map((ref) => ({ id: ref.id, version: ref.version, title: "产品资料", summary: "白色包装", content: "白色包装，纸盒结构", fieldValues: { product_name: "白色包装" }, sourceKind: "fake", sourceAssetPaths: [], contentSha256: "c".repeat(64), published: true } satisfies RagChunk)); },
    },
    llmClient: {
      provider: "deterministic_fake",
      model: "ticket08-fixed",
      isFake: true,
      async generatePlan(input) {
        calls.push(input);
        return { schemaVersion: "suite-plan-v1", items: [{ title: "主图", purpose: "展示商品", prompt: "纯白背景展示包装。", imageType: "main" }] };
      },
    } satisfies LlmClient,
  });
  const uploaded = await app.upload(suite.id, { filename: "white.png", mimeType: "image/png", bytes: imageBytes });
  const inputId = (uploaded.body as any).data.id as string;
  const started = await app.request("POST", `/api/suites/${suite.id}/plan`, {
    headers: { "idempotency-key": randomUUID() },
    body: { templateVersionId: template.templateVersionId, dynamicInput: { product_name: "白色包装" }, humanInput: { style_guide: "干净、克制" }, selectedChunks: [{ id: "chunk.product", version: "1" }], inputImageIds: [inputId] },
  });
  assert.equal(started.status, 202);
  for (let index = 0; index < 30 && calls.length === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].templateVersionId, template.templateVersionId);
  assert.match(calls[0].templateBody, /商品名称/);
  assert.deepEqual(calls[0].dynamicInput, { product_name: "白色包装" });
  assert.deepEqual(calls[0].humanInput, { style_guide: "干净、克制" });
  assert.deepEqual(calls[0].chunks.map((chunk) => chunk.id), ["chunk.product"]);
  assert.deepEqual(calls[0].inputImageIds, [inputId]);
});

test("fixed image counts reject an LLM plan with the wrong number of outputs", async () => {
  const { planOutputMatchesRequestedCounts } = await import("../server/app.js");
  const requested = { output_mode: "combined", main_image_count_mode: "fixed", main_image_count: 2, detail_image_count_mode: "fixed", detail_image_count: 1 };
  assert.equal(planOutputMatchesRequestedCounts({ items: [{ imageType: "main" }, { imageType: "detail" }] }, requested), false);
  assert.equal(planOutputMatchesRequestedCounts({ items: [{ imageType: "main" }, { imageType: "main" }, { imageType: "detail" }] }, requested), true);
});

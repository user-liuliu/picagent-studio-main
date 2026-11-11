import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createTicket02App } from "../server/app.js";
import { isNormalizedPromptMarkdown, parseNormalizedPromptMarkdown, parsePromptMarkdown, validateDynamicInput } from "../server/prompt-library.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import type { ImageEditRequest, ImageProvider } from "../server/types.js";

const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function markdown(name: string, body: string) {
  return [`### ${name}`, "", "```plain", body, "```"].join("\n");
}

test("imports only fenced prompt bodies and derives per-template input schemas", () => {
  const records = parsePromptMarkdown([
    "### 模板 A", "", "说明，不是提示词。", "", "```plain", "用户输入区：", "- 平台：Amazon", "- 品牌名：", "```",
    "", "## 不是运行模板", "普通说明", "", "### 模板 B", "", "```plain", "用户输入区：", "- 产品名称：", "```",
  ].join("\n"), "prompt.md");
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].inputSchema.map((field) => field.key), ["platform", "brand_name"]);
  assert.equal(records[0].inputSchema[0].defaultValue, "Amazon");
  assert.deepEqual(records[1].inputSchema.map((field) => field.key), ["product_name"]);
  assert.match(records[0].sourceSha256, /^[a-f0-9]{64}$/);
});

test("normalized planning templates expose explicit modes and system-only runtime bodies", async () => {
  const normalized = await readFile("prompt/normalized/general-plan-combined.md", "utf8");
  const record = parseNormalizedPromptMarkdown(normalized, "prompt/normalized/general-plan-combined.md");
  assert.equal(record.code, "general.plan.combined");
  assert.equal(record.stage, "plan");
  assert.deepEqual(record.inputSchema.filter((field) => field.key.endsWith("_mode")).map((field) => field.key), [
    "output_mode",
    "main_image_count_mode",
    "detail_image_count_mode",
    "brand_mode",
    "selling_points_mode",
    "parameters_mode",
    "design_style_mode",
  ]);
  assert.equal(record.inputSchema.find((field) => field.key === "platform")?.required, true);
  assert.equal(record.body.includes("## User Prompt Template"), false);
  assert.equal((record.outputSchema.properties as Record<string, unknown>).items !== undefined, true);
});

test("normalized prompt detection accepts Windows CRLF frontmatter", () => {
  assert.equal(isNormalizedPromptMarkdown("---\r\ncode: general.plan.combined\r\n---\r\n"), true);
});

test("normalized combined template validates fixed counts and explicit no-brand mode", async () => {
  const normalized = await readFile("prompt/normalized/general-plan-combined.md", "utf8");
  const record = parseNormalizedPromptMarkdown(normalized, "prompt/normalized/general-plan-combined.md");
  const missingCounts = validateDynamicInput(record.inputSchema, {
    output_mode: "combined", platform: "Amazon", output_language: "中文",
    main_image_count_mode: "fixed", detail_image_count_mode: "auto",
    brand_mode: "no_brand", selling_points_mode: "derive", parameters_mode: "to_confirm", design_style_mode: "auto",
  });
  assert.equal(missingCounts.ok, false);
  const valid = validateDynamicInput(record.inputSchema, {
    output_mode: "combined", platform: "Amazon", output_language: "中文",
    main_image_count_mode: "fixed", main_image_count: 2, detail_image_count_mode: "auto",
    brand_mode: "no_brand", selling_points_mode: "derive", parameters_mode: "to_confirm", design_style_mode: "auto",
  });
  assert.equal(valid.ok, true);
});

test("the real prompt corpus gives every plan template usable template-specific fields", async () => {
  const records = parsePromptMarkdown(await readFile("prompt/prompt.md", "utf8"), "prompt/prompt.md");
  const planRecords = records.filter((record) => record.stage === "plan");
  assert.equal(planRecords.length, 16);
  assert.deepEqual(planRecords.filter((record) => record.inputSchema.length === 0).map((record) => record.name), []);
  const mainOnly = planRecords.find((record) => record.name === "海产品主图提示词")!;
  const detailOnly = planRecords.find((record) => record.name === "海产品详情页提示词")!;
  assert.equal(mainOnly.inputSchema.some((field) => field.key === "detail_image_count"), false);
  assert.equal(detailOnly.inputSchema.some((field) => field.key === "main_image_count"), false);
  const peopleTemplate = planRecords.find((record) => record.name.includes("可选模特与人脸规则"));
  assert.ok(peopleTemplate);
  assert.deepEqual(
    ["platform", "target_market_country", "brand_name", "product_category", "main_image_type", "model_requirement", "forbid_face", "allow_image_text"].filter((key) => !peopleTemplate.inputSchema.some((field) => field.key === key)),
    [],
  );
  assert.equal(peopleTemplate.inputSchema.find((field) => field.key === "main_image_type")?.defaultValue, undefined);
  assert.deepEqual(
    ["seafood_type", "product_specification", "net_weight", "origin", "storage_method", "shipping_method", "serving_method"].filter((key) => !mainOnly.inputSchema.some((field) => field.key === key)),
    [],
  );
  assert.equal(mainOnly.inputSchema.some((field) => field.key === "product_parameters"), false);
});

test("draft versions stay hidden until publish and public listings never expose bodies", async () => {
  const prompts = new MemoryPromptRepository();
  const [draft] = await prompts.importRecords(parsePromptMarkdown(markdown("产品图转干净产品底图返修提示词", "保持产品外观并生成白底图。"), "prompt.md"));
  assert.deepEqual(await prompts.listPublished("base_refine"), []);
  await prompts.publishVersion(draft.templateVersionId);
  await prompts.importRecords([{ ...parsePromptMarkdown(markdown("产品图转干净产品底图返修提示词", "保持产品外观并生成白底图。"), "prompt.md")[0], body: "不应覆盖已发布正文" }]);
  const listed = await prompts.listPublished("base_refine");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].templateVersionId, draft.templateVersionId);
  assert.equal("body" in listed[0], false);
  assert.equal((await prompts.getPublishedVersion(draft.templateVersionId, "plan")), null);
  assert.equal((await prompts.getPublishedVersion(draft.templateVersionId, "base_refine"))?.body, "保持产品外观并生成白底图。");
});

test("same source import is idempotent and changed source appends an immutable version", async () => {
  const prompts = new MemoryPromptRepository();
  const firstSource = parsePromptMarkdown(markdown("通用计划模板", "用户输入区：\n- 产品名称："), "prompt.md");
  const legacyDraft = [{ ...firstSource[0], inputSchema: [...firstSource[0].inputSchema, { key: "brand_name", label: "品牌名", type: "text" as const, required: false, order: 1 }] }];
  const [first] = await prompts.importRecords(legacyDraft);
  const [same] = await prompts.importRecords(firstSource);
  const [second] = await prompts.importRecords(parsePromptMarkdown(markdown("通用计划模板", "用户输入区：\n- 产品名称：\n- 品牌名："), "prompt.md"));
  assert.equal(same.templateVersionId, first.templateVersionId);
  assert.deepEqual(same.inputSchema.map((field) => field.key), ["product_name"]);
  assert.equal(second.templateId, first.templateId);
  assert.equal(second.versionNo, 2);
  assert.equal((await prompts.listVersions(first.templateId)).length, 2);
});

test("template API exposes only published stage metadata and schema", async () => {
  const prompts = new MemoryPromptRepository();
  const [draft] = await prompts.importRecords(parsePromptMarkdown(markdown("计划模板", "用户输入区：\n- 产品名称："), "prompt.md"));
  await prompts.publishVersion(draft.templateVersionId);
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage(), promptRepository: prompts });
  const response = await api.request("GET", "/api/prompt-templates?stage=plan");
  assert.equal(response.status, 200);
  assert.equal(response.body.data[0].templateVersionId, draft.templateVersionId);
  assert.deepEqual(response.body.data[0].inputSchema.map((field: { key: string }) => field.key), ["product_name"]);
  assert.equal("body" in response.body.data[0], false);
});

test("platform API exposes maintained dropdown options without prompt bodies", async () => {
  const api = createTicket02App({
    repository: new MemorySuiteRepository(),
    storage: new MemoryStorage(),
    platformRepository: {
      async listEnabled() {
        return [{ code: "amazon", name: "Amazon", marketScope: "overseas", mainImageStrategy: "白底", galleryStrategy: "细节", textStrategy: "无首图文字", modelStrategy: "默认无脸", sourceNote: "official", sortOrder: 10 }];
      },
      async find(value: string) { return value === "amazon" ? (await this.listEnabled())[0] : null; },
    },
  });
  const response = await api.request("GET", "/api/platforms");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.map((platform: { code: string }) => platform.code), ["amazon"]);
  assert.equal(response.body.data[0].mainImageStrategy, "白底");
});

test("base generation loads a published PG template and freezes its version and dynamic input", async () => {
  const prompts = new MemoryPromptRepository();
  const [draft] = await prompts.importRecords(parsePromptMarkdown(markdown("产品图转干净产品底图返修提示词", "保持产品外观并生成白底图。"), "prompt.md"));
  await prompts.publishVersion(draft.templateVersionId);
  const calls: ImageEditRequest[] = [];
  const provider: ImageProvider = { edit: async (request) => { calls.push(request); return { bytes: png1x1, mimeType: "image/png" }; } };
  const repository = new MemorySuiteRepository();
  const api = createTicket02App({ repository, storage: new MemoryStorage(), provider, promptRepository: prompts });
  const suite = await api.request("POST", "/api/suites", { body: { name: "模板快照" } });
  const uploaded = await api.upload(suite.body.data.id, { filename: "product.png", mimeType: "image/png", bytes: png1x1 });
  const path = `/api/suites/${suite.body.data.id}/input-images/${uploaded.body.data.id}/base-generation`;
  const missing = await api.request("POST", path, { headers: { "idempotency-key": "missing-template" } });
  assert.equal(missing.status, 400);
  const generated = await api.request("POST", path, { headers: { "idempotency-key": "with-template" }, body: { templateVersionId: draft.templateVersionId, dynamicInput: {} } });
  assert.equal(generated.status, 202);
  for (let index = 0; index < 100 && (await repository.listGenerationAttempts(suite.body.data.id, uploaded.body.data.id))[0]?.status === "running"; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(calls[0].prompt, "保持产品外观并生成白底图。");
  assert.equal(generated.body.data.attempt.templateVersionId, draft.templateVersionId);
  const attempts = await repository.listGenerationAttempts(suite.body.data.id, uploaded.body.data.id);
  assert.equal(attempts[0].promptTemplateVersionId, draft.templateVersionId);
  assert.deepEqual(attempts[0].dynamicInput, {});
});

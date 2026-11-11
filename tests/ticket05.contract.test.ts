import assert from "node:assert/strict";
import test from "node:test";
import { createTicket02App, planOutputMatchesRequestedCounts } from "../server/app.js";
import { MemoryPlanRepository } from "../server/repositories/memory-plan-repository.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import { parsePromptMarkdown } from "../server/prompt-library.js";
import type { LlmClient, RagChunk, RagClient } from "../server/types.js";

const planMarkdown = `## 验证计划\n\n\`\`\`text\n- 商品名称（必填）：\n请输出套图计划。\n\`\`\``;

async function setup(options: { output?: unknown; llm?: boolean; chunks?: RagChunk[] } = {}) {
  const suites = new MemorySuiteRepository();
  const prompts = new MemoryPromptRepository();
  const [template] = await prompts.importRecords(parsePromptMarkdown(planMarkdown, "test.md"));
  await prompts.publishVersion(template.templateVersionId);
  const suite = await suites.createSuite("Ticket 05");
  const plans = new MemoryPlanRepository();
  const chunks = options.chunks ?? [{ id: "validation.mouse", version: "1", title: "鼠标可见资料", summary: "黑色鼠标", content: "黑色鼠标，带滚轮。", fieldValues: { product_name: "黑色鼠标" }, sourceKind: "validation_seed", sourceAssetPaths: ["素材/实拍图/鼠标1.jpg"], contentSha256: "a".repeat(64), published: true }];
  const rag: RagClient = {
    async search() { return chunks.map(({ content: _content, published: _published, ...chunk }) => chunk); },
    async getByIds(refs) { return refs.map((ref) => chunks.find((chunk) => chunk.id === ref.id)!).filter(Boolean); },
  };
  const llm: LlmClient | undefined = options.llm === false ? undefined : {
    provider: "deterministic_fake", model: "ticket05-fixed", isFake: true,
    async generatePlan() { return options.output ?? { schemaVersion: "suite-plan-v1", items: [{ title: "白底首图", purpose: "展示商品", prompt: "保持黑色鼠标真实外观，纯白背景。" }] }; },
  };
  return { app: createTicket02App({ repository: suites, storage: new MemoryStorage(), promptRepository: prompts, planRepository: plans, ragClient: rag, llmClient: llm }), suite, template, plans };
}

async function waitForTerminal(app: Awaited<ReturnType<typeof setup>>["app"], attemptId: string) {
  for (let index = 0; index < 30; index += 1) {
    const response = await app.request("GET", `/api/plan-attempts/${attemptId}`);
    const data = (response.body as { data: { status: string } }).data;
    if (data.status !== "running") return response;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("attempt did not finish");
}

test("plan request returns 202 and freezes only selected chunks before creating an immutable snapshot", async () => {
  const { app, suite, template, plans } = await setup();
  const started = await app.request("POST", `/api/suites/${suite.id}/plan`, { headers: { "idempotency-key": "plan-1" }, body: { templateVersionId: template.templateVersionId, dynamicInput: { product_name: "人工商品名" }, humanInput: { notes: "保留外观" }, selectedChunks: [{ id: "validation.mouse", version: "1" }] } });
  assert.equal(started.status, 202);
  const attemptId = (started.body as { data: { attemptId: string } }).data.attemptId;
  const terminal = await waitForTerminal(app, attemptId);
  const data = (terminal.body as { data: any }).data;
  assert.equal(data.status, "succeeded");
  assert.equal(data.provider.isFake, true);
  assert.equal(data.snapshot.templateVersionId, template.templateVersionId);
  assert.deepEqual(data.snapshot.chunks.map((chunk: any) => [chunk.sourceChunkId, chunk.sourceVersion, chunk.content]), [["validation.mouse", "1", undefined]]);
  assert.equal((await plans.getLatestSnapshot(suite.id))?.chunks[0].content, "黑色鼠标，带滚轮。");
  assert.equal(data.snapshot.items.length, 1);
  assert.equal(JSON.stringify(terminal.body).includes("请输出套图计划"), false, "API must not expose template body");
});

test("missing LLM configuration fails explicitly without a fake success", async () => {
  const { app, suite, template } = await setup({ llm: false });
  const response = await app.request("POST", `/api/suites/${suite.id}/plan`, { headers: { "idempotency-key": "missing-llm" }, body: { templateVersionId: template.templateVersionId, dynamicInput: { product_name: "鼠标" }, selectedChunks: [] } });
  assert.equal(response.status, 503);
  assert.equal((response.body as any).error.code, "LLM_NOT_CONFIGURED");
});

test("LLM timeout is persisted as LLM_TIMEOUT with retryable user message", async () => {
  const timeoutSuites = new MemorySuiteRepository(); const timeoutPrompts = new MemoryPromptRepository();
  const [timeoutTemplate] = await timeoutPrompts.importRecords(parsePromptMarkdown(planMarkdown, "timeout.md")); await timeoutPrompts.publishVersion(timeoutTemplate.templateVersionId);
  const timeoutSuite = await timeoutSuites.createSuite("timeout"); const timeoutPlans = new MemoryPlanRepository();
  const started = await createTicket02App({ repository: timeoutSuites, storage: new MemoryStorage(), promptRepository: timeoutPrompts, planRepository: timeoutPlans, ragClient: { async search(){return []}, async getByIds(){return []} }, llmClient: { provider: "dashscope", model: "timeout", isFake: false, async generatePlan(){ throw new Error("LLM_TIMEOUT"); } } }).request("POST", `/api/suites/${timeoutSuite.id}/plan`, { headers: { "idempotency-key": "timeout" }, body: { templateVersionId: timeoutTemplate.templateVersionId, dynamicInput: { product_name: "鼠标" }, selectedChunks: [] } });
  const terminal = await waitForTerminal(createTicket02App({ repository: timeoutSuites, storage: new MemoryStorage(), promptRepository: timeoutPrompts, planRepository: timeoutPlans, ragClient: { async search(){return []}, async getByIds(){return []} }, llmClient: { provider: "dashscope", model: "timeout", isFake: false, async generatePlan(){ throw new Error("LLM_TIMEOUT"); } } }), (started.body as any).data.attemptId);
  assert.equal((terminal.body as any).data.errorCode, "LLM_TIMEOUT"); assert.equal((terminal.body as any).data.errorMessage, "计划生成超时，请重试");
});

test("chunk version drift fails before LLM and schema-invalid output creates no plan", async () => {
  const drift = await setup();
  const drifted = await drift.app.request("POST", `/api/suites/${drift.suite.id}/plan`, { headers: { "idempotency-key": "drift" }, body: { templateVersionId: drift.template.templateVersionId, dynamicInput: { product_name: "鼠标" }, selectedChunks: [{ id: "validation.mouse", version: "old" }] } });
  assert.equal(drifted.status, 409);
  assert.equal((drifted.body as any).error.code, "RAG_CHUNK_VERSION_DRIFT");

  const invalid = await setup({ output: { items: [{ title: "缺提示词" }] } });
  const started = await invalid.app.request("POST", `/api/suites/${invalid.suite.id}/plan`, { headers: { "idempotency-key": "bad-schema" }, body: { templateVersionId: invalid.template.templateVersionId, dynamicInput: { product_name: "鼠标" }, selectedChunks: [] } });
  const terminal = await waitForTerminal(invalid.app, (started.body as any).data.attemptId);
  assert.equal((terminal.body as any).data.status, "failed");
  assert.equal((terminal.body as any).data.errorCode, "LLM_OUTPUT_SCHEMA_INVALID");
  assert.equal((terminal.body as any).data.snapshot, null);
});

test("normalizes common LLM plan wrappers into the immutable plan schema", async () => {
  const setupResult = await setup({ output: { plans: [{ name: "主图首图", description: "展示商品主体", prompt: "保持产品真实外观并使用干净背景。" }] } });
  const started = await setupResult.app.request("POST", `/api/suites/${setupResult.suite.id}/plan`, { headers: { "idempotency-key": "wrapped-output" }, body: { templateVersionId: setupResult.template.templateVersionId, dynamicInput: { product_name: "鼠标" }, selectedChunks: [] } });
  const terminal = await waitForTerminal(setupResult.app, (started.body as any).data.attemptId);
  assert.equal((terminal.body as any).data.status, "succeeded");
  assert.deepEqual((terminal.body as any).data.snapshot.items.map((item: any) => [item.title, item.purpose, item.prompt]), [["主图首图", "展示商品主体", "保持产品真实外观并使用干净背景。"]]);
});

test("preserves image type when LLM separates main and detail wrappers", async () => {
  const setupResult = await setup({ output: { mainImages: [{ title: "平台首图", purpose: "先看懂商品", prompt: "白底展示商品主体。" }], detailImages: [{ title: "接口细节", purpose: "确认结构", prompt: "近景展示接口细节。" }] } });
  const started = await setupResult.app.request("POST", `/api/suites/${setupResult.suite.id}/plan`, { headers: { "idempotency-key": "typed-wrappers" }, body: { templateVersionId: setupResult.template.templateVersionId, dynamicInput: { product_name: "鼠标" }, selectedChunks: [] } });
  const terminal = await waitForTerminal(setupResult.app, (started.body as any).data.attemptId);
  assert.equal((terminal.body as any).data.status, "succeeded");
  assert.deepEqual((terminal.body as any).data.snapshot.items.map((item: any) => item.imageType), ["main", "detail"]);
});

test("fixed main and detail counts reject an incomplete model plan", () => {
  const requested = { output_mode: "combined", main_image_count_mode: "fixed", main_image_count: 1, detail_image_count_mode: "fixed", detail_image_count: 2 };
  assert.equal(planOutputMatchesRequestedCounts({ items: [{ imageType: "main" }] }, requested), false);
  assert.equal(planOutputMatchesRequestedCounts({ items: [{ imageType: "main" }, { imageType: "detail" }, { imageType: "detail" }] }, requested), true);
});

test("a missing historical object returns 404 instead of crashing the API", async () => {
  const suites=new MemorySuiteRepository(); const suite=await suites.createSuite("missing object");
  const image=await suites.createInputImage({id:"00000000-0000-4000-8000-000000000001",suiteId:suite.id,ordinal:1,originalObjectKey:`suites/${suite.id}/inputs/00000000-0000-4000-8000-000000000001/original`,thumbnailObjectKey:`suites/${suite.id}/inputs/00000000-0000-4000-8000-000000000001/thumbnail`,sha256:"b".repeat(64),width:1,height:1,mimeType:"image/png",originalFilename:"missing.png",currentBaseVersionId:null,createdAt:new Date().toISOString()});
  const storage={...new MemoryStorage(),put:async()=>{},get:async()=>null,delete:async()=>{},previewUrl:async()=>{throw new Error("OBJECT_NOT_FOUND");}}; const app=createTicket02App({repository:suites,storage});
  const response=await app.preview(suite.id,image.id,"original"); assert.equal(response.status,404);
});

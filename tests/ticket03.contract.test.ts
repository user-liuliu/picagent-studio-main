import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createTicket02App } from "../server/app.js";
import { parsePromptMarkdown } from "../server/prompt-library.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import type { ImageEditRequest, ImageProvider } from "../server/types.js";

const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const prompt = "请把我上传的产品图精修成适合后续电商主图和详情页生图参考的干净产品底图。\n\n严格保持产品原本的品类、轮廓、比例、结构、颜色、材质、表面工艺、Logo、包装和可见细节不变。将背景处理为干净纯白、浅灰白或极简中性底色，去除杂物、水印、脏污、过曝、混乱阴影和无关元素。不要新增原图没有的按钮、接口、配件、包装、文字、纹理、装饰、功能结构或品牌元素。输出主体完整、边缘清晰、光影自然、真实可信的产品底图。";

class FakeProvider implements ImageProvider {
  calls: ImageEditRequest[] = [];
  failNext = false;

  async edit(request: ImageEditRequest) {
    this.calls.push(request);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("provider response included Authorization: Bearer secret-key and https://temporary.example/result.png");
    }
    return { bytes: png1x1, mimeType: "image/png" as const };
  }
}

async function setup() {
  const provider = new FakeProvider();
  const storage = new MemoryStorage();
  const prompts = new MemoryPromptRepository();
  const [version] = await prompts.importRecords(parsePromptMarkdown(`### 产品图转干净产品底图返修提示词\n\n\`\`\`plain\n${prompt}\n\`\`\``, "prompt.md"));
  await prompts.publishVersion(version.templateVersionId);
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage, provider, promptRepository: prompts });
  const suite = await api.request("POST", "/api/suites", { body: { name: "鼠标套图" } });
  const suiteId = suite.body.data.id as string;
  const uploaded = await api.upload(suiteId, { filename: "鼠标1.png", mimeType: "image/png", bytes: png1x1 });
  return { api, provider, storage, suiteId, inputImageId: uploaded.body.data.id as string, templateVersionId: version.templateVersionId };
}

async function generate(api: ReturnType<typeof createTicket02App>, suiteId: string, inputImageId: string, key: string, templateVersionId: string) {
  const path = `/api/suites/${suiteId}/input-images/${inputImageId}/base-generation`;
  const options = {
    headers: { "idempotency-key": key }, body: { templateVersionId, dynamicInput: {} },
  };
  const started = await api.request("POST", path, options);
  if (started.status !== 202) return started;
  for (let index = 0; index < 200; index += 1) {
    const history = await api.request("GET", `/api/suites/${suiteId}/input-images/${inputImageId}/base-versions`);
    const attempt = history.body.data.attempts.find((item: { id: string }) => item.id === started.body.data.attempt.id);
    if (attempt?.status === "succeeded") return api.request("POST", path, options);
    if (attempt?.status === "failed") return { status: 502, body: { error: { code: attempt.errorCode, message: attempt.errorMessage }, requestId: "test" } };
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("generation test timed out");
}

test("provider is idle before click and one generation uses the fixed edit parameters", async () => {
  const { api, provider, storage, suiteId, inputImageId, templateVersionId } = await setup();
  assert.equal(provider.calls.length, 0);

  const generated = await generate(api, suiteId, inputImageId, "generate-1", templateVersionId);

  assert.equal(generated.status, 200);
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(
    {
      endpoint: provider.calls[0].endpoint,
      model: provider.calls[0].model,
      n: provider.calls[0].n,
      size: provider.calls[0].size,
      quality: provider.calls[0].quality,
      responseFormat: provider.calls[0].responseFormat,
      prompt: provider.calls[0].prompt,
    },
    { endpoint: "/v1/images/edits", model: "gpt-image-2", n: 1, size: "1K", quality: "medium", responseFormat: "b64_json", prompt },
  );
  assert.equal(generated.body.data.version.versionNumber, 1);
  assert.match(generated.body.data.version.previewUrl, /\/base-versions\/[^/]+\/preview$/);
  assert.equal(storage.keys().filter((key) => key.endsWith("/final.png")).length, 1);
  assert.match(storage.keys().find((key) => key.endsWith("/final.png"))!, new RegExp(`^suites/${suiteId}/inputs/${inputImageId}/base/[^/]+/final\\.png$`));
});

test("successive generations append versions and old versions remain previewable and selectable", async () => {
  const { api, provider, suiteId, inputImageId, templateVersionId } = await setup();
  await generate(api, suiteId, inputImageId, "generate-1", templateVersionId);
  await generate(api, suiteId, inputImageId, "generate-2", templateVersionId);
  assert.equal(provider.calls.length, 2);

  const history = await api.request("GET", `/api/suites/${suiteId}/input-images/${inputImageId}/base-versions`);
  assert.deepEqual(history.body.data.versions.map((version: { versionNumber: number }) => version.versionNumber), [2, 1]);
  assert.equal(history.body.data.currentVersionId, history.body.data.versions[0].id);

  const oldVersion = history.body.data.versions[1];
  const preview = await api.previewBaseVersion(suiteId, inputImageId, oldVersion.id);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers?.["content-type"], "image/png");
  assert.equal(preview.raw?.subarray(1, 4).toString("ascii"), "PNG");

  const selected = await api.request("POST", `/api/suites/${suiteId}/input-images/${inputImageId}/base-versions/${oldVersion.id}/select`);
  assert.equal(selected.status, 200);
  const restored = await api.request("GET", `/api/suites/${suiteId}/input-images/${inputImageId}/base-versions`);
  assert.equal(restored.body.data.currentVersionId, oldVersion.id);
});

test("a failed attempt is restored without changing the previous current version", async () => {
  const { api, provider, suiteId, inputImageId, templateVersionId } = await setup();
  await generate(api, suiteId, inputImageId, "generate-1", templateVersionId);
  const before = await api.request("GET", `/api/suites/${suiteId}/input-images/${inputImageId}/base-versions`);
  provider.failNext = true;

  const failed = await generate(api, suiteId, inputImageId, "generate-failed", templateVersionId);
  assert.equal(failed.status, 502);

  const restored = await api.request("GET", `/api/suites/${suiteId}/input-images/${inputImageId}/base-versions`);
  assert.equal(restored.body.data.currentVersionId, before.body.data.currentVersionId);
  assert.equal(restored.body.data.versions.length, 1);
  assert.equal(restored.body.data.attempts[0].status, "failed");
  assert.equal(restored.body.data.attempts[0].errorCode, "IMAGE_PROVIDER_FAILED");

  const recovered = await generate(api, suiteId, inputImageId, "generate-after-failure", templateVersionId);
  assert.equal(recovered.body.data.version.versionNumber, 2);
});

test("the same idempotency key never calls the provider twice", async () => {
  const { api, provider, suiteId, inputImageId, templateVersionId } = await setup();
  const first = await generate(api, suiteId, inputImageId, "same-key", templateVersionId);
  const retry = await generate(api, suiteId, inputImageId, "same-key", templateVersionId);
  assert.equal(first.body.data.attempt.id, retry.body.data.attempt.id);
  assert.equal(provider.calls.length, 1);
});

test("generation starts in the background and exposes running history without holding the POST open", async () => {
  let completeProvider!: () => void;
  const provider: ImageProvider = {
    edit: async () => {
      await new Promise<void>((resolve) => { completeProvider = resolve; });
      return { bytes: png1x1, mimeType: "image/png" };
    },
  };
  const storage = new MemoryStorage();
  const prompts = new MemoryPromptRepository();
  const [version] = await prompts.importRecords(parsePromptMarkdown(`### 产品图转干净产品底图返修提示词\n\n\`\`\`plain\n${prompt}\n\`\`\``, "prompt.md"));
  await prompts.publishVersion(version.templateVersionId);
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage, provider, promptRepository: prompts });
  const suite = await api.request("POST", "/api/suites", { body: { name: "后台精修" } });
  const suiteId = suite.body.data.id as string;
  const uploaded = await api.upload(suiteId, { filename: "mouse.png", mimeType: "image/png", bytes: png1x1 });
  const started = await Promise.race([
    api.request("POST", `/api/suites/${suiteId}/input-images/${uploaded.body.data.id}/base-generation`, {
      headers: { "idempotency-key": "background" }, body: { templateVersionId: version.templateVersionId, dynamicInput: {} },
    }),
    new Promise<"held-open">((resolve) => setTimeout(() => resolve("held-open"), 50)),
  ]);
  assert.notEqual(started, "held-open");
  assert.equal((started as Awaited<ReturnType<typeof generate>>).status, 202);
  const running = await api.request("GET", `/api/suites/${suiteId}/input-images/${uploaded.body.data.id}/base-versions`);
  assert.equal(running.body.data.attempts[0].status, "running");
  completeProvider();
});

test("generation APIs never expose credentials, provider responses, object keys or temporary URLs", async () => {
  const { api, provider, suiteId, inputImageId, templateVersionId } = await setup();
  provider.failNext = true;
  const failed = await generate(api, suiteId, inputImageId, "redaction", templateVersionId);
  const history = await api.request("GET", `/api/suites/${suiteId}/input-images/${inputImageId}/base-versions`);
  const serialized = JSON.stringify([failed.body, history.body]);
  assert.doesNotMatch(serialized, /secret-key|Authorization|temporary\.example|originalObjectKey|objectKey|b64_json/i);
});

test("an uploaded image can be cancelled before generation and the provider remains idle", async () => {
  const { api, provider, storage, suiteId, inputImageId } = await setup();
  const removed = await api.request("DELETE", `/api/suites/${suiteId}/input-images/${inputImageId}`);
  assert.equal(removed.status, 200);
  assert.equal(provider.calls.length, 0);
  assert.equal((await api.request("GET", `/api/suites/${suiteId}`)).body.data.inputImages.length, 0);
  assert.equal(storage.keys().length, 0);
});

test("provider timeout is recorded as a failed attempt instead of leaving generation running", async () => {
  const provider: ImageProvider = { edit: async () => { throw new Error("IMAGE_PROVIDER_TIMEOUT"); } };
  const storage = new MemoryStorage();
  const prompts = new MemoryPromptRepository();
  const [version] = await prompts.importRecords(parsePromptMarkdown(`### 产品图转干净产品底图返修提示词\n\n\`\`\`plain\n${prompt}\n\`\`\``, "prompt.md"));
  await prompts.publishVersion(version.templateVersionId);
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage, provider, promptRepository: prompts });
  const suite = await api.request("POST", "/api/suites", { body: { name: "超时测试" } });
  const suiteId = suite.body.data.id as string;
  const uploaded = await api.upload(suiteId, { filename: "mouse.png", mimeType: "image/png", bytes: png1x1 });
  const response = await generate(api, suiteId, uploaded.body.data.id, "timeout", version.templateVersionId);
  assert.equal(response.status, 502);
  assert.equal("error" in response.body && response.body.error.code, "IMAGE_PROVIDER_TIMEOUT");
  const history = await api.request("GET", `/api/suites/${suiteId}/input-images/${uploaded.body.data.id}/base-versions`);
  assert.equal(history.body.data.attempts[0].status, "failed");
  assert.equal(history.body.data.attempts[0].errorCode, "IMAGE_PROVIDER_TIMEOUT");
});

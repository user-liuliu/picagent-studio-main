import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { DashScopeLlmClient } from "../server/providers/dashscope-llm-client.js";
import { GptImageProvider } from "../server/providers/gpt-image-provider.js";

async function archiveFiles(requestId: string) {
  const files = await readdir("var/model-archives", { recursive: true });
  return files.filter((file) => file.includes(requestId)).map((file) => `var/model-archives/${file.replaceAll("\\", "/")}`);
}

test("archives multimodal plan and image generation inputs and responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const planRequestId = `archive-plan-${Date.now()}`;
    globalThis.fetch = async () => new Response(JSON.stringify({ id: "chat-1", choices: [{ message: { content: JSON.stringify({ schemaVersion: "suite-plan-v1", items: [] }) } }], usage: { total_tokens: 12 } }), { status: 200, headers: { "content-type": "application/json" } });
    await new DashScopeLlmClient("https://example.test/v1/", "secret", "qwen3.8-max").generatePlan({
      requestId: planRequestId,
      templateVersionId: "template-1",
      templateBody: "system prompt",
      userPromptTemplate: "商品={{dynamic_input}}",
      dynamicInput: { product: "mouse" },
      humanInput: {},
      chunks: [],
      inputImageIds: ["input-1"],
      baseVersionIds: ["base-1"],
      visionImages: [{ id: "input-1", sourceKind: "base", sourceVersionId: "base-1", mimeType: "image/png", bytes: Buffer.from("vision-bytes") }],
    });
    const planFiles = await archiveFiles(planRequestId);
    assert.equal(planFiles.some((file) => /multimodal-plan.*_request\.json$/.test(file)), true);
    assert.equal(planFiles.some((file) => /multimodal-plan.*_response\.json$/.test(file)), true);
    const planRequestPath = planFiles.find((file) => file.endsWith("_request.json"))!;
    const planRequest = await readFile(planRequestPath, "utf8");
    assert.match(planRequest, /system prompt/);
    assert.match(planRequest, /archive-input-1/);
    assert.doesNotMatch(planRequest, /data:image\/png;base64/);
    const planInputPath = planFiles.find((file) => file.includes("_input-01-"))!;
    assert.deepEqual(await readFile(planInputPath), Buffer.from("vision-bytes"));
    assert.match(await readFile(planFiles.find((file) => file.endsWith("_response.json"))!, "utf8"), /suite-plan-v1/);

    const imageRequestId = `archive-image-${Date.now()}`;
    const generatedBytes = Buffer.from("generated-image-bytes");
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ b64_json: generatedBytes.toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } });
    await new GptImageProvider("https://example.test", "secret").edit({ requestId: imageRequestId, flow: "suite-task-generation", endpoint: "/v1/images/edits", image: Buffer.from("source-image"), imageMimeType: "image/png", imageFilename: "source.png", model: "gpt-image-2", prompt: "keep the product unchanged", size: "1K", quality: "medium", n: 1, responseFormat: "b64_json" });
    const imageFiles = await archiveFiles(imageRequestId);
    assert.equal(imageFiles.some((file) => /image-generation.*_request\.json$/.test(file)), true);
    assert.equal(imageFiles.some((file) => /image-generation.*_response\.json$/.test(file)), true);
    assert.match(await readFile(imageFiles.find((file) => file.endsWith("_request.json"))!, "utf8"), /keep the product unchanged/);
    const outputPath = imageFiles.find((file) => file.includes("_output-01-"))!;
    assert.deepEqual(await readFile(outputPath), generatedBytes);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanUserContent } from "../server/providers/dashscope-llm-client.js";

test("builds a multimodal planning message with the actual image bytes", () => {
  const content = buildPlanUserContent({
    templateVersionId: "template-1",
    templateBody: "system",
    dynamicInput: { product_name: "鼠标" },
    humanInput: {},
    chunks: [],
    inputImageIds: ["input-1"],
    baseVersionIds: ["base-1"],
    visionImages: [{ id: "input-1", sourceKind: "base", sourceVersionId: "base-1", mimeType: "image/png", bytes: Buffer.from("png-bytes") }],
  });
  assert.equal(content[0].type, "text");
  assert.equal(content[1].type, "image_url");
  assert.equal(content[1].image_url.url, `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`);
});

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseNormalizedPromptMarkdown, validatePromptTemplateContract } from "../server/prompt-library.js";
import { MemoryPromptRepository } from "../server/repositories/memory-prompt-repository.js";

test("V1.1 normalized templates expose the V2 structure contract and isolated category stage", async () => {
  const structure = parseNormalizedPromptMarkdown(await readFile("prompt/normalized/general-structure-plan.md", "utf8"), "prompt/normalized/general-structure-plan.md");
  const category = parseNormalizedPromptMarkdown(await readFile("prompt/normalized/general-category-prompt.md", "utf8"), "prompt/normalized/general-category-prompt.md");
  assert.equal(structure.code, "general.structure-plan");
  assert.equal(structure.stage, "structure_plan");
  assert.equal((structure.outputSchema.properties as Record<string, any>).schemaVersion.const, "suite-structure-plan-v2");
  assert.ok(structure.inputSchema.some((field) => field.key === "human_supplement"));
  assert.ok(structure.inputSchema.some((field) => field.key === "emphasis_requirements"));
  assert.ok(structure.inputSchema.some((field) => field.key === "design_constraints"));
  assert.ok((structure.outputSchema.required as string[]).includes("mainAllocation"));
  assert.ok(!(structure.outputSchema.required as string[]).includes("mainImageCount"));
  assert.ok(!(structure.outputSchema.required as string[]).includes("canProceed"));
  assert.equal(category.code, "general.category-prompt");
  assert.equal(category.stage, "category_prompt");
  assert.equal((category.outputSchema.properties as Record<string, any>).schemaVersion.const, "suite-category-prompt-v1");
  assert.equal(category.inputSchema.find((field) => field.key === "requested_count")?.required, true);
  assert.equal(category.inputSchema.find((field) => field.key === "human_supplement")?.required, false);
  assert.equal(category.inputSchema.find((field) => field.key === "approved_fact_refs")?.required, true);
});

test("the old one-shot output contract cannot be relabeled as a V1.1 template", async () => {
  const source = await readFile("prompt/normalized/general-plan-combined.md", "utf8");
  const relabeled = source.replace("code: general.plan.combined", "code: general.structure-plan").replace("stage: plan", "stage: structure_plan");
  assert.throws(() => parseNormalizedPromptMarkdown(relabeled, "legacy-relabeled.md"), /incompatible output schema|one-shot plan contract|missing input field/);
});

test("V1.1 versions publish independently while legacy plan remains readable", async () => {
  const prompts = new MemoryPromptRepository();
  const structure = parseNormalizedPromptMarkdown(await readFile("prompt/normalized/general-structure-plan.md", "utf8"), "prompt/normalized/general-structure-plan.md");
  const legacy = parseNormalizedPromptMarkdown(await readFile("prompt/normalized/general-plan-combined.md", "utf8"), "prompt/normalized/general-plan-combined.md");
  const [structureDraft, legacyDraft] = await prompts.importRecords([structure, legacy]);
  await prompts.publishVersion(structureDraft.templateVersionId);
  await prompts.publishVersion(legacyDraft.templateVersionId);
  assert.deepEqual((await prompts.listPublished("structure_plan")).map((item) => item.code), ["general.structure-plan"]);
  assert.deepEqual((await prompts.listPublished("plan")).map((item) => item.code), ["general.plan.combined"]);
  assert.equal((await prompts.getPublishedVersion(legacyDraft.templateVersionId, "plan"))?.stage, "plan");
});

test("V1.1 contract validator rejects a wrong stage/code pairing", () => {
  assert.throws(() => validatePromptTemplateContract({
    code: "general.wrong",
    kind: "planner",
    stage: "structure_plan",
    executionTarget: "llm",
    inputSchema: [],
    outputSchema: { properties: { schemaVersion: { const: "suite-structure-plan-v2" } } },
    body: "suite-structure-plan-v2",
  }), /template code/);
});

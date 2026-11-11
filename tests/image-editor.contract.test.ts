import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { ImageEditorService, MemoryImageEditorRepository, type EditOperation, type ImageEditProvider, type ImageSource } from "../server/image-editor.js";
import { createImageEditorApi } from "../server/image-editor-api.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";

const source: ImageSource = { bytes: Buffer.from("source"), mimeType: "image/png", width: 100, height: 100 };
const operation = (type: EditOperation["type"] = "re_edit"): EditOperation => ({ operationId: "op-1", type, order: 1, sourceCardId: "parent", sourceVersionId: "version-1", parentVersionId: "version-1", summary: "调整背景", payload: type === "redraw" ? { prompt: "局部重绘", strokes: [{ points: [{ x: 0.1, y: 0.2 }], width: 0.1 }] } : { prompt: "调整背景" } });

function provider(overrides: Partial<ImageEditProvider> = {}): ImageEditProvider {
  return {
    name: "fake-image-editor", version: "1", capabilitiesVersion: "1",
    capabilities: () => ({ imageToImage: true, addText: true, changeText: true, redraw: true, erase: true, outpaint: true, currentVersionInput: true }),
    edit: async () => ({ bytes: Buffer.from("result"), mimeType: "image/png", width: 100, height: 100 }),
    ...overrides,
  };
}

async function settle() { await new Promise((resolve) => setTimeout(resolve, 10)); }

test("submission freezes ordered operations and is idempotent", async () => {
  const repository = new MemoryImageEditorRepository(); const service = new ImageEditorService(repository, provider(), new MemoryStorage(), async () => source);
  await service.upsertOperation({ sessionId: "session", operation: operation() });
  await service.upsertOperation({ sessionId: "session", operation: { ...operation("add_text"), operationId: "op-2", summary: "添加标题" } });
  const first = await service.submit({ sessionId: "session", idempotencyKey: "same", sourceCardId: "parent", sourceVersionId: "version-1", summary: "组合编辑" });
  const duplicate = await service.submit({ sessionId: "session", idempotencyKey: "same", sourceCardId: "parent", sourceVersionId: "version-1", summary: "组合编辑" });
  assert.equal(first.duplicate, false); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.childTask.id, first.childTask.id); assert.deepEqual(first.snapshot.operations.map((item) => item.operationId), ["op-1", "op-2"]);
  await settle(); const task = await repository.getChildTask(first.childTask.id); const versions = await repository.listVersions(first.childTask.id); assert.equal(task?.currentVersionId, versions[0].id); assert.equal(task?.finalVersionId, null);
});

test("unsupported capability rejects before child task creation", async () => {
  const repository = new MemoryImageEditorRepository(); const service = new ImageEditorService(repository, provider({ capabilities: () => ({ imageToImage: true, addText: true, changeText: true, redraw: false, erase: true, outpaint: true, currentVersionInput: true }) }), new MemoryStorage(), async () => source);
  await service.upsertOperation({ sessionId: "session", operation: operation("redraw") });
  await assert.rejects(service.submit({ sessionId: "session", idempotencyKey: "blocked", sourceCardId: "parent", sourceVersionId: "version-1" }), /IMAGE_EDIT_CAPABILITY_UNSUPPORTED:redraw/);
});

test("failure retains child task, creates no version, and retry reuses snapshot", async () => {
  let calls = 0; const repository = new MemoryImageEditorRepository(); const service = new ImageEditorService(repository, provider({ edit: async () => { calls += 1; if (calls === 1) throw new Error("MODEL_FAILED"); return { bytes: Buffer.from("ok"), mimeType: "image/png", width: 100, height: 100 }; } }), new MemoryStorage(), async () => source);
  await service.upsertOperation({ sessionId: "session", operation: operation() }); const submitted = await service.submit({ sessionId: "session", idempotencyKey: "submit", sourceCardId: "parent", sourceVersionId: "version-1" }); await settle();
  assert.equal((await repository.getChildTask(submitted.childTask.id))?.status, "failed"); assert.equal((await repository.listVersions(submitted.childTask.id)).length, 0);
  const retried = await service.retry(submitted.attempt.id, "retry"); assert.equal(retried.childTask.id, submitted.childTask.id); assert.equal(retried.snapshot.id, submitted.snapshot.id); await settle(); assert.equal((await repository.listVersions(submitted.childTask.id)).length, 1); assert.equal((await repository.listAttempts(submitted.childTask.id)).length, 2);
});

test("current and final selections are independent", async () => {
  const repository = new MemoryImageEditorRepository(); const service = new ImageEditorService(repository, provider(), new MemoryStorage(), async () => source);
  await service.upsertOperation({ sessionId: "session", operation: operation() }); const submitted = await service.submit({ sessionId: "session", idempotencyKey: "submit", sourceCardId: "parent", sourceVersionId: "version-1" }); await settle(); const first = (await repository.listVersions(submitted.childTask.id))[0];
  await service.selectVersion(submitted.childTask.id, first.id, "final"); const task = await repository.getChildTask(submitted.childTask.id); assert.equal(task?.currentVersionId, first.id); assert.equal(task?.finalVersionId, first.id);
});

test("change_text requires OCR and freezes the OCR snapshot", async () => {
  const repository = new MemoryImageEditorRepository();
  const service = new ImageEditorService(repository, provider(), new MemoryStorage(), async () => source, { name: "fake-ocr", version: "1", recognize: async () => ({ blocks: [{ id: "text-1", text: "旧文案", confidence: 0.99, bounds: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 }, rotation: 0 }] }) });
  const change: EditOperation = { ...operation("change_text"), payload: { prompt: "替换文字", originalText: "旧文案", newText: "新文案", region: { x: 0.1, y: 0.1, width: 0.3, height: 0.1 } } };
  await service.upsertOperation({ sessionId: "session", operation: change });
  await assert.rejects(service.submit({ sessionId: "session", idempotencyKey: "without-ocr", sourceCardId: "parent", sourceVersionId: "version-1" }), /OCR_REQUIRED/);
  await service.recognize("session", "version-1");
  const submitted = await service.submit({ sessionId: "session", idempotencyKey: "with-ocr", sourceCardId: "parent", sourceVersionId: "version-1" });
  const frozen = submitted.snapshot.operations[0].payload.ocrSnapshot as { sourceVersionId: string; status: string };
  assert.equal(frozen.sourceVersionId, "version-1"); assert.equal(frozen.status, "succeeded");
});

test("redraw materializes a same-size grayscale mask with persisted metadata", async () => {
  const repository = new MemoryImageEditorRepository(); const storage = new MemoryStorage(); const service = new ImageEditorService(repository, provider(), storage, async () => source);
  await service.upsertOperation({ sessionId: "session", operation: { ...operation("redraw"), payload: { prompt: "局部重绘", strokes: [{ points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], width: 0.12 }], feather: 0.25 } } });
  const submitted = await service.submit({ sessionId: "session", idempotencyKey: "mask", sourceCardId: "parent", sourceVersionId: "version-1" });
  const mask = submitted.snapshot.operations[0].payload.mask as { width: number; height: number; mimeType: string; sha256: string; objectKey: string; feather: number };
  assert.deepEqual({ width: mask.width, height: mask.height, mimeType: mask.mimeType, feather: mask.feather }, { width: 100, height: 100, mimeType: "image/png", feather: 0.25 });
  assert.match(mask.sha256, /^[a-f0-9]{64}$/); assert.equal(mask.objectKey, `image-edits/masks/version-1/op-1-${mask.sha256}.png`);
  const object = await storage.get(mask.objectKey); assert.ok(object); assert.equal(object.contentType, "image/png");
  const metadata = await sharp(object.bytes).metadata(); assert.equal(metadata.format, "png"); assert.equal(metadata.width, 100); assert.equal(metadata.height, 100); assert.equal(metadata.channels, 1);
  const pixels = await sharp(object.bytes).removeAlpha().grayscale().raw().toBuffer(); assert.ok([...pixels].some((value) => value > 0 && value < 255), "feather must produce soft mask pixels");
});

test("outpaint freezes computed dimensions and anchor, and rejects conflicting dimensions", async () => {
  const repository = new MemoryImageEditorRepository(); const seen: Array<EditOperation> = []; const editProvider = provider({ edit: async (command) => { seen.push(...command.operations); return { bytes: Buffer.from("result"), mimeType: "image/png", width: 100, height: 100 }; } });
  const outpaintSource: ImageSource = { bytes: Buffer.from("source"), mimeType: "image/png", width: 100, height: 200 }; const service = new ImageEditorService(repository, editProvider, new MemoryStorage(), async () => outpaintSource);
  await service.upsertOperation({ sessionId: "session", operation: { ...operation("outpaint"), payload: { direction: "right", targetRatio: "1:1" } } });
  const submitted = await service.submit({ sessionId: "session", idempotencyKey: "outpaint", sourceCardId: "parent", sourceVersionId: "version-1" });
  assert.deepEqual(submitted.snapshot.operations[0].payload, { direction: "right", targetRatio: "1:1", targetWidth: 200, targetHeight: 200, anchor: "right" });
  await settle(); assert.equal(seen[0].payload.targetWidth, 200); assert.equal(seen[0].payload.targetHeight, 200);
  const invalidRepository = new MemoryImageEditorRepository(); const invalidService = new ImageEditorService(invalidRepository, provider(), new MemoryStorage(), async () => outpaintSource);
  await invalidService.upsertOperation({ sessionId: "session", operation: { ...operation("outpaint"), payload: { direction: "right", targetRatio: "1:1", targetWidth: 100 } } });
  await assert.rejects(invalidService.submit({ sessionId: "session", idempotencyKey: "outpaint-invalid", sourceCardId: "parent", sourceVersionId: "version-1" }), /OUTPAINT_TARGET_DIMENSIONS_INVALID/);
});

test("regenerate endpoint appends an attempt and version to the same child task", async () => {
  const repository = new MemoryImageEditorRepository(); const service = new ImageEditorService(repository, provider(), new MemoryStorage(), async () => source); const api = createImageEditorApi(service);
  await service.upsertOperation({ sessionId: "session", operation: operation() });
  const first = await api.request("POST", "/api/image-editor/sessions/session/submit", { headers: { "idempotency-key": "submit" }, body: { sourceCardId: "parent", sourceVersionId: "version-1" } });
  assert.equal(first.status, 202); const firstData = (first.body as { data: { childTask: { id: string } } }).data; await settle();
  const regenerated = await api.request("POST", `/api/image-editor/tasks/${firstData.childTask.id}/regenerate`, { headers: { "idempotency-key": "regenerate" }, body: { summary: "再生成" } });
  assert.equal(regenerated.status, 202); const duplicate = await api.request("POST", `/api/image-editor/tasks/${firstData.childTask.id}/regenerate`, { headers: { "idempotency-key": "regenerate" }, body: { summary: "ignored" } }); assert.equal(duplicate.status, 200);
  await settle(); const task = await repository.getChildTask(firstData.childTask.id); assert.equal(task?.id, firstData.childTask.id); assert.equal((await repository.listAttempts(firstData.childTask.id)).length, 2); assert.equal((await repository.listVersions(firstData.childTask.id)).length, 2);
});

test("submission freezes the exact source-version prompt and composes operation prompts", async () => {
  const repository = new MemoryImageEditorRepository();
  const commands: Array<{ prompt: string }> = [];
  const service = new ImageEditorService(repository, provider({ edit: async (command) => { commands.push(command); return { bytes: Buffer.from("result"), mimeType: "image/png", width: 100, height: 100 }; } }), new MemoryStorage(), async () => ({ ...source, generationPrompt: "SOURCE VERSION PROMPT" }));
  await service.upsertOperation({ sessionId: "session", operation: { ...operation("add_text"), payload: { text: "新品主视觉", region: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 }, prompt: "使用醒目的无衬线标题，与画面光线融合" } } });
  const submitted = await service.submit({ sessionId: "session", idempotencyKey: "prompt-compose", sourceCardId: "parent", sourceVersionId: "version-1", summary: "添加文字" });
  assert.equal(submitted.snapshot.sourcePrompt, "SOURCE VERSION PROMPT");
  await settle();
  assert.match(commands[0].prompt, /SOURCE VERSION PROMPT/);
  assert.match(commands[0].prompt, /新品主视觉/);
  assert.match(commands[0].prompt, /使用醒目的无衬线标题/);
});

test("mask eraser strokes subtract from previously painted mask pixels", async () => {
  const repository = new MemoryImageEditorRepository(); const storage = new MemoryStorage();
  const service = new ImageEditorService(repository, provider(), storage, async () => source);
  await service.upsertOperation({ sessionId: "session", operation: { ...operation("redraw"), payload: { prompt: "局部重绘", strokes: [
    { mode: "draw", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], width: 0.2 },
    { mode: "erase", points: [{ x: 0.5, y: 0.5 }], width: 0.1 },
  ], feather: 0 } } });
  const submitted = await service.submit({ sessionId: "session", idempotencyKey: "mask-eraser", sourceCardId: "parent", sourceVersionId: "version-1" });
  const mask = submitted.snapshot.operations[0].payload.mask as { objectKey: string };
  const object = await storage.get(mask.objectKey); assert.ok(object);
  const pixels = await sharp(object.bytes).removeAlpha().grayscale().raw().toBuffer();
  assert.ok(pixels[50 * 100 + 30] > 200, "painted area remains selected");
  assert.ok(pixels[50 * 100 + 50] < 20, "eraser removes the selected center area");
});

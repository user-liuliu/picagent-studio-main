import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { createTicket02App } from "../server/app.js";
import { MemoryPlanRepository } from "../server/repositories/memory-plan-repository.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryTaskRepository } from "../server/repositories/memory-task-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";
import type { PlanSnapshot } from "../server/types.js";

async function fixture() {
  const repository = new MemorySuiteRepository(); const storage = new MemoryStorage(); const plans = new MemoryPlanRepository(); const tasks = new MemoryTaskRepository(); const providerInputs: Buffer[] = [];
  const suite = await repository.createSuite("Ticket 06"); const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).png().toBuffer();
  await storage.put({ key: "input/original.png", bytes, contentType: "image/png" });
  const input = await repository.createInputImage({ id: randomUUID(), suiteId: suite.id, ordinal: 1, originalObjectKey: "input/original.png", thumbnailObjectKey: "input/original.png", sha256: "a".repeat(64), width: 64, height: 64, mimeType: "image/png", originalFilename: "source.png", currentBaseVersionId: null, createdAt: new Date().toISOString() });
  const snapshot: PlanSnapshot = { id: randomUUID(), suiteId: suite.id, revisionNumber: 1, revisionKind: "human", parentSnapshotId: null, templateVersionId: randomUUID(), dynamicInput: {}, humanInput: {}, chunks: [], inputImageIds: [input.id], baseVersionIds: [], provider: { name: "fake", model: "fake", isFake: true }, requestSummary: {}, rawOutputSummary: {}, schemaVersion: "suite-plan-v1", items: [{ id: randomUUID(), ordinal: 1, imageType: "main", title: "主图一", purpose: "展示主体", prompt: "main" }, { id: randomUUID(), ordinal: 2, imageType: "detail", title: "详情一", purpose: "展示细节", prompt: "detail" }], createdAt: new Date().toISOString() };
  await plans.appendRevision(snapshot);
  const api = createTicket02App({ repository, storage, planRepository: plans, taskRepository: tasks, provider: { edit: async (request) => { providerInputs.push(request.image); return { bytes, mimeType: "image/png" }; } } });
  return { api, suite, snapshot, plans, providerInputs, bytes };
}

test("creates real tasks from latest plan and is idempotent", async () => {
  const { api, suite, snapshot } = await fixture();
  const first = await api.request("POST", `/api/suites/${suite.id}/tasks`, { headers: { "idempotency-key": "create-1" }, body: { planSnapshotId: snapshot.id } });
  assert.equal(first.status, 201); assert.equal((first.body as any).data.tasks.length, 2); assert.deepEqual((first.body as any).data.tasks.map((task: any) => task.imageType), ["main", "detail"]);
  const second = await api.request("POST", `/api/suites/${suite.id}/tasks`, { headers: { "idempotency-key": "create-2" }, body: { planSnapshotId: snapshot.id } });
  assert.equal(second.status, 200); assert.equal((second.body as any).data.tasks.length, 2);
});

test("creating tasks from a newer snapshot archives old tasks and exposes three active cards", async () => {
  const { api, suite, snapshot, plans } = await fixture();
  await api.request("POST", `/api/suites/${suite.id}/tasks`, { headers: { "idempotency-key": "create-old" }, body: { planSnapshotId: snapshot.id } });
  const nextSnapshot: PlanSnapshot = {
    ...snapshot,
    id: randomUUID(),
    revisionNumber: 2,
    parentSnapshotId: snapshot.id,
    items: [
      { id: randomUUID(), ordinal: 1, imageType: "main", title: "主图一", purpose: "展示主体", prompt: "main" },
      { id: randomUUID(), ordinal: 2, imageType: "detail", title: "详情一", purpose: "展示细节一", prompt: "detail-1" },
      { id: randomUUID(), ordinal: 3, imageType: "detail", title: "详情二", purpose: "展示细节二", prompt: "detail-2" },
    ],
    createdAt: new Date().toISOString(),
  };
  await plans.appendRevision(nextSnapshot);
  const created = await api.request("POST", `/api/suites/${suite.id}/tasks`, { headers: { "idempotency-key": "create-new" }, body: { planSnapshotId: nextSnapshot.id } });
  assert.equal(created.status, 201);
  const workbench = await api.request("GET", `/api/suites/${suite.id}/workbench`);
  const allTasks = (workbench.body as any).data.tasks;
  const activeTasks = allTasks.filter((task) => task.status !== "archived" && task.planSnapshotId === nextSnapshot.id);
  assert.equal(allTasks.filter((task) => task.planSnapshotId === snapshot.id).every((task) => task.status === "archived"), true);
  assert.equal(activeTasks.length, 3);
  assert.deepEqual(activeTasks.map((task) => task.imageType), ["main", "detail", "detail"]);
});

test("batch generation uses one slot per task and persists versions", async () => {
  const { api, suite, snapshot } = await fixture(); await api.request("POST", `/api/suites/${suite.id}/tasks`, { headers: { "idempotency-key": "create" }, body: { planSnapshotId: snapshot.id } });
  const started = await api.request("POST", `/api/suites/${suite.id}/generation`, { headers: { "idempotency-key": "batch" }, body: {} }); assert.equal(started.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 50)); const workbench = await api.request("GET", `/api/suites/${suite.id}/workbench`); const data = (workbench.body as any).data; assert.equal(data.tasks.length, 2); assert.equal(data.tasks.every((task: any) => task.status === "generated"), true); assert.equal(data.tasks.reduce((sum: number, task: any) => sum + task.slots.length, 0), 2); assert.equal(data.tasks.reduce((sum: number, task: any) => sum + task.versions.length, 0), 2);
});

test("single generation adds one new version without LLM", async () => {
  const { api, suite, snapshot, providerInputs, bytes } = await fixture(); await api.request("POST", `/api/suites/${suite.id}/tasks`, { headers: { "idempotency-key": "create" }, body: { planSnapshotId: snapshot.id } }); const started = await api.request("POST", `/api/suites/${suite.id}/generation`, { headers: { "idempotency-key": "batch" }, body: {} }); assert.equal(started.status, 202); await new Promise((resolve) => setTimeout(resolve, 50)); const before = await api.request("GET", `/api/suites/${suite.id}/workbench`); const task = ((before.body as any).data.tasks[0]);
  const one = await api.request("POST", `/api/suite-tasks/${task.id}/generation`, { headers: { "idempotency-key": "single" }, body: { promptDraft: "revised" } }); assert.equal(one.status, 202); await new Promise((resolve) => setTimeout(resolve, 50)); const after = await api.request("GET", `/api/suites/${suite.id}/workbench`); const updated = (after.body as any).data.tasks.find((item: any) => item.id === task.id); assert.equal(after.body && (after.body as any).data.tasks.length, (before.body as any).data.tasks.length); assert.equal(updated.versions.length, 2); assert.equal(updated.attempts.at(-1).promptSnapshot.prompt, "revised"); assert.equal(providerInputs.length, 3); assert.deepEqual(providerInputs[2], bytes);
});

test("canvas layout persists node bindings and viewport", async () => {
  const { api, suite, snapshot } = await fixture();
  await api.request("POST", `/api/suites/${suite.id}/tasks`, { headers: { "idempotency-key": "create" }, body: { planSnapshotId: snapshot.id } });
  const saved = await api.request("PATCH", `/api/suites/${suite.id}/workbench/layout`, { body: { layoutVersion: 0, viewport: { x: 12, y: -8, zoom: 1.25 }, nodes: [{ nodeId: "task:main", x: 240, y: 120, groupKey: "group:main" }], groups: [{ groupKey: "group:main", x: 100, y: 40, width: 470, height: 250 }] } });
  assert.equal(saved.status, 200);
  const restored = await api.request("GET", `/api/suites/${suite.id}/workbench/layout`);
  assert.deepEqual((restored.body as any).data.viewport, { x: 12, y: -8, zoom: 1.25 });
  assert.equal((restored.body as any).data.nodes[0].groupKey, "group:main");
});

test("saving an identical canvas layout is idempotent", async () => {
  const { api, suite } = await fixture();
  const layout = { layoutVersion: 0, viewport: { x: 12, y: -8, zoom: 1.25 }, nodes: [{ nodeId: "task:main", x: 240, y: 120, groupKey: "group:main" }], groups: [{ groupKey: "group:main", x: 100, y: 40, width: 470, height: 250 }] };
  const first = await api.request("PATCH", `/api/suites/${suite.id}/workbench/layout`, { body: layout });
  const second = await api.request("PATCH", `/api/suites/${suite.id}/workbench/layout`, { body: layout });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((second.body as any).data.layoutVersion, (first.body as any).data.layoutVersion);
});

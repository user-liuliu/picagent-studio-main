import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createTicket02App } from "../server/app.js";
import { MemorySuiteRepository } from "../server/repositories/memory-suite-repository.js";
import { MemoryStorage } from "../server/storage/memory-storage.js";

const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function app() {
  return createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage() });
}

test("creates a suite idempotently and restores it", async () => {
  const api = app();
  const first = await api.request("POST", "/api/suites", { headers: { "idempotency-key": "suite-1" }, body: { name: "耳机套图" } });
  const second = await api.request("POST", "/api/suites", { headers: { "idempotency-key": "suite-1" }, body: { name: "不同名称" } });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.data.id, first.body.data.id);
  const restored = await api.request("GET", `/api/suites/${first.body.data.id}`);
  assert.equal(restored.body.data.name, "耳机套图");
});

test("rejects non-images, invalid mime and oversized files", async () => {
  const api = app();
  const suite = await api.request("POST", "/api/suites", { body: { name: "测试" } });
  const id = suite.body.data.id as string;
  for (const file of [
    { filename: "x.txt", mimeType: "text/plain", bytes: Buffer.from("hello") },
    { filename: "x.jpg", mimeType: "image/jpeg", bytes: Buffer.from("not-an-image") },
  ]) {
    const result = await api.upload(id, file);
    assert.equal(result.status, 400);
  }
});

test("persists image metadata, hash and suite-scoped object keys", async () => {
  const storage = new MemoryStorage();
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage });
  const suite = await api.request("POST", "/api/suites", { body: { name: "测试" } });
  const result = await api.upload(suite.body.data.id as string, { filename: "耳机1.png", mimeType: "image/png", bytes: png1x1 });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.ordinal, 1);
  assert.equal(result.body.data.width, 1);
  assert.equal(result.body.data.height, 1);
  assert.match(result.body.data.sha256, /^[a-f0-9]{64}$/);
  assert.match(result.body.data.originalObjectKey, new RegExp(`^suites/${suite.body.data.id}/inputs/`));
  assert.notEqual(result.body.data.originalObjectKey, result.body.data.thumbnailObjectKey);
  assert.equal(storage.keys().length, 3);
  assert.ok(storage.keys().some((key) => key.endsWith("/generation-input.jpg")));
});

test("enforces 1-6 ordinals and idempotent image upload", async () => {
  const api = app();
  const suite = await api.request("POST", "/api/suites", { body: { name: "测试" } });
  const id = suite.body.data.id as string;
  const first = await api.upload(id, { filename: "a.png", mimeType: "image/png", bytes: png1x1, ordinal: 1, idempotencyKey: "img-1" });
  const retry = await api.upload(id, { filename: "a.png", mimeType: "image/png", bytes: png1x1, ordinal: 1, idempotencyKey: "img-1" });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.data.id, first.body.data.id);
  assert.equal((await api.upload(id, { filename: "b.png", mimeType: "image/png", bytes: png1x1, ordinal: 1 })).status, 409);
  assert.equal((await api.upload(id, { filename: "c.png", mimeType: "image/png", bytes: png1x1, ordinal: 7 })).status, 400);
});

test("rejects the same image only within the same suite", async () => {
  const api = app();
  const firstSuite = await api.request("POST", "/api/suites", { body: { name: "方案 A" } });
  const secondSuite = await api.request("POST", "/api/suites", { body: { name: "方案 B" } });
  const firstId = firstSuite.body.data.id as string;
  const secondId = secondSuite.body.data.id as string;
  assert.equal((await api.upload(firstId, { filename: "a.png", mimeType: "image/png", bytes: png1x1 })).status, 201);
  const duplicate = await api.upload(firstId, { filename: "copy.png", mimeType: "image/png", bytes: png1x1 });
  assert.equal(duplicate.status, 409);
  assert.equal("error" in duplicate.body && duplicate.body.error.code, "DUPLICATE_IMAGE");
  assert.equal((await api.upload(secondId, { filename: "a.png", mimeType: "image/png", bytes: png1x1 })).status, 201);
});

test("does not call an image provider before generation", async () => {
  const calls: string[] = [];
  const api = createTicket02App({ repository: new MemorySuiteRepository(), storage: new MemoryStorage(), provider: { generate: async () => { calls.push("called"); } } });
  const suite = await api.request("POST", "/api/suites", { body: { name: "测试" } });
  await api.upload(suite.body.data.id as string, { filename: "a.png", mimeType: "image/png", bytes: png1x1 });
  assert.deepEqual(calls, []);
});

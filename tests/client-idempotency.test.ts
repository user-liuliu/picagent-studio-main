import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createIdempotencyKey } from "../src/api/client.js";

test("creates unique idempotency keys without crypto.randomUUID", () => {
  const first = createIdempotencyKey({});
  const second = createIdempotencyKey({});

  assert.match(first, /^[a-z0-9-]+$/);
  assert.notEqual(first, second);
});

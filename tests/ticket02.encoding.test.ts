import { strict as assert } from "node:assert";
import { test } from "node:test";
import { decodeMultipartFilename, parseMultipartFile } from "../server/multipart.js";

test("decodes UTF-8 multipart filenames sent through a latin1 header parser", () => {
  const mojibakeHeader = Buffer.from("耳机1.jpg", "utf8").toString("latin1");
  assert.equal(decodeMultipartFilename(undefined, mojibakeHeader), "耳机1.jpg");
  assert.equal(decodeMultipartFilename(encodeURIComponent("鼠标2.jpg"), "ignored.jpg"), "鼠标2.jpg");
});

test("parses a multipart image without changing its binary bytes", () => {
  const boundary = "----picagent-test";
  const bytes = Buffer.from([0, 255, 1, 128, 42]);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename*=UTF-8''${encodeURIComponent("详情图.png")}\r\nContent-Type: image/png\r\n\r\n`, "latin1"),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, "latin1"),
  ]);

  const parsed = parseMultipartFile(body, `multipart/form-data; boundary=${boundary}`);

  assert.equal(parsed?.filename, "详情图.png");
  assert.equal(parsed?.mimeType, "image/png");
  assert.deepEqual(parsed?.bytes, bytes);
});

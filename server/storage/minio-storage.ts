import { Client } from "minio";
import type { StorageAdapter, StorageObject } from "../types.js";

export class MinioStorage implements StorageAdapter {
  constructor(private readonly client: Client, private readonly bucket: string, private readonly expirySeconds = 300, private readonly fallbackBucket?: string) {}
  async put(object: StorageObject) { await this.client.putObject(this.bucket, object.key, object.bytes, object.bytes.length, { "Content-Type": object.contentType }); }
  private async resolveBucket(key: string): Promise<string> {
    try { await this.client.statObject(this.bucket, key); return this.bucket; }
    catch (error) {
      if (!this.fallbackBucket) throw normalizeObjectError(error);
      try { await this.client.statObject(this.fallbackBucket, key); return this.fallbackBucket; }
      catch (fallbackError) { throw normalizeObjectError(fallbackError); }
    }
  }
  async get(key: string) {
    const bucket = await this.resolveBucket(key);
    const metadata = await this.client.statObject(bucket, key);
    const chunkSize = 64 * 1024;
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < metadata.size; offset += chunkSize) {
      const expected = Math.min(chunkSize, metadata.size - offset);
      const stream = await this.client.getPartialObject(bucket, key, offset, expected);
      const chunk = await new Promise<Buffer>((resolve, reject) => {
        const parts: Buffer[] = [];
        let received = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(Buffer.concat(parts, received));
        };
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          stream.destroy();
          reject(new Error("OBJECT_READ_TIMEOUT"));
        }, 60_000);
        stream.on("data", (part) => {
          const buffer = Buffer.from(part);
          parts.push(buffer);
          received += buffer.length;
          if (received >= expected) {
            stream.destroy();
            finish();
          }
        });
        stream.once("end", finish);
        stream.once("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
      });
      if (chunk.length !== expected) throw new Error("OBJECT_READ_INCOMPLETE");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks, metadata.size);
    return { key, bytes, contentType: metadata.metaData?.["content-type"] ?? "application/octet-stream" };
  }
  async previewUrl(key: string) { return this.client.presignedGetObject(await this.resolveBucket(key), key, this.expirySeconds); }
  async delete(key: string) { await this.client.removeObject(this.bucket, key); }
}

function normalizeObjectError(error: unknown): Error {
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? (error as { statusCode?: number }).statusCode : undefined;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  return statusCode === 404 || /NoSuch|NotFound/i.test(code) ? new Error("OBJECT_NOT_FOUND") : new Error("OBJECT_READ_FAILED");
}

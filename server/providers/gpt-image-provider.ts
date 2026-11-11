import { randomUUID } from "node:crypto";
import type { ImageEditRequest, ImageProvider } from "../types.js";
import { failModelArchive, finishModelArchive, startModelArchive } from "../prompt-archive.js";
import { failObservation, finishObservation, logObservation, recordImageFailure, recordImageSuccess, startGeneration } from "../observability.js";

export class GptImageProvider implements ImageProvider {
  readonly supportsMultipleImages = true;
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 600_000) {}

  async edit(request: ImageEditRequest) {
    const startedAt = Date.now();
    const observation = startGeneration("image.edit", {
      prompt: request.prompt,
      images: (request.images?.length ? request.images : [{ bytes: request.image, mimeType: request.imageMimeType, filename: request.imageFilename, role: "product" }]).map((item) => ({ mimeType: item.mimeType, filename: item.filename, role: item.role, byteLength: item.bytes.length })),
      mask: request.mask ? { mimeType: request.maskMimeType, byteLength: request.mask.length } : undefined,
    }, { flow: request.flow ?? "image-edit", provider: "openai-compatible-image", model: request.model });
    const requestId = request.requestId ?? randomUUID();
    const images = request.images?.length ? request.images : [{ bytes: request.image, mimeType: request.imageMimeType, filename: request.imageFilename, role: "product" }];
    const archive = await startModelArchive({
      type: "image-generation",
      flow: request.flow ?? "image-edit",
      requestId,
      provider: "openai-compatible-image",
      model: request.model,
      request: {
        endpoint: new URL(request.endpoint, this.baseUrl).toString(),
        model: request.model,
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        n: request.n,
        responseFormat: request.responseFormat,
        images: images.map((item) => ({ filename: item.filename, mimeType: item.mimeType, byteLength: item.bytes.length, role: item.role })),
        mask: request.mask ? { filename: request.maskFilename ?? "mask.png", mimeType: request.maskMimeType ?? "image/png", byteLength: request.mask.length } : undefined,
      },
      inputFiles: images.map((item) => ({ label: item.role ?? "reference", filename: item.filename, mimeType: item.mimeType, bytes: item.bytes })),
    });
    const form = new FormData();
    form.append("model", request.model);
    for (const item of images) form.append("image", new Blob([Uint8Array.from(item.bytes)], { type: item.mimeType }), item.filename);
    if (request.mask) form.append("mask", new Blob([Uint8Array.from(request.mask)], { type: request.maskMimeType ?? "image/png" }), request.maskFilename ?? "mask.png");
    form.append("prompt", request.prompt);
    form.append("size", request.size);
    form.append("quality", request.quality);
    form.append("n", String(request.n));
    form.append("response_format", request.responseFormat);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let responseSummary: unknown;
    try {
      const response = await fetch(new URL(request.endpoint, this.baseUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        responseSummary = { httpStatus: response.status, body: await response.text().catch(() => "") };
        throw new Error("IMAGE_PROVIDER_FAILED");
      }
      const payload = await response.json().catch(() => null) as { data?: Array<{ b64_json?: unknown }> } | null;
      const encoded = payload?.data?.[0]?.b64_json;
      if (typeof encoded !== "string" || !encoded) throw new Error("INVALID_PROVIDER_RESPONSE");
      const bytes = Buffer.from(encoded, "base64");
      if (!bytes.length) throw new Error("INVALID_PROVIDER_RESPONSE");
      responseSummary = { httpStatus: response.status, dataCount: payload?.data?.length ?? 0, mimeType: "image/png", byteLength: bytes.length };
      await finishModelArchive(archive, responseSummary, [{ label: "generated-image", filename: "generated-image.png", mimeType: "image/png", bytes }]);
      finishObservation(observation, { status: "succeeded", outputMimeType: "image/png", outputByteLength: bytes.length }, { http_status: response.status, output_type: "image" });
      recordImageSuccess(request.flow ?? "image-edit", "openai-compatible-image", request.model, Date.now() - startedAt);
      logObservation("image.completed", { request_id: requestId, flow: request.flow ?? "image-edit", provider: "openai-compatible-image", model: request.model, duration_ms: Date.now() - startedAt, status: "success" });
      return { bytes, mimeType: "image/png" };
    } catch (error) {
      const normalized = error instanceof DOMException && error.name === "AbortError"
        ? new Error("IMAGE_PROVIDER_TIMEOUT")
        : error instanceof Error && error.message === "INVALID_PROVIDER_RESPONSE"
          ? error
          : new Error("IMAGE_PROVIDER_FAILED");
      await failModelArchive(archive, normalized, responseSummary);
      failObservation(observation, normalized);
      recordImageFailure(request.flow ?? "image-edit", "openai-compatible-image", request.model, Date.now() - startedAt, normalized.message);
      logObservation("image.failed", { request_id: requestId, flow: request.flow ?? "image-edit", provider: "openai-compatible-image", model: request.model, duration_ms: Date.now() - startedAt, status: "error", error_code: normalized.message });
      throw normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}

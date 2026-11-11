import { randomUUID } from "node:crypto";
import type { ImageEditorService } from "./image-editor.js";
import type { ErrorEnvelope, ResponseEnvelope } from "./types.js";

export interface ImageEditorApiResponse { status: number; body: ResponseEnvelope<unknown> | ErrorEnvelope }
const ok = (data: unknown, status = 200): ImageEditorApiResponse => ({ status, body: { data, requestId: randomUUID() } });
const fail = (code: string, status = 400): ImageEditorApiResponse => ({ status, body: { error: { code, message: code }, requestId: randomUUID() } });

export function createImageEditorApi(service: ImageEditorService) {
  return {
    async request(method: string, path: string, options: { headers?: Record<string, string>; body?: unknown } = {}): Promise<ImageEditorApiResponse> {
      const body = options.body && typeof options.body === "object" ? options.body as Record<string, unknown> : {};
      const idempotencyKey = options.headers?.["idempotency-key"] ?? options.headers?.["Idempotency-Key"];
      if (method === "GET" && path === "/api/image-editor/capabilities") return ok(await service.capabilities());
      const sessionMatch = path.match(/^\/api\/image-editor\/sessions\/([^/]+)$/);
      if (method === "GET" && sessionMatch) { const draft = await service.getDraft(sessionMatch[1]); return draft ? ok(draft) : fail("EDIT_SESSION_NOT_FOUND", 404); }
      const taskMatch = path.match(/^\/api\/image-editor\/tasks\/([^/]+)$/);
      if (method === "GET" && taskMatch) { const result = await service.getTask(taskMatch[1]); return result ? ok(result) : fail("INVALID_IMAGE_EDIT_TASK", 404); }
      if (method === "GET" && path === "/api/image-editor/tasks") return ok(await service.listAllTasks());
      const sourceCardMatch = path.match(/^\/api\/image-editor\/source-cards\/([^/]+)\/tasks$/);
      if (method === "GET" && sourceCardMatch) return ok(await service.listTasksBySourceCard(sourceCardMatch[1]));
      const operationMatch = path.match(/^\/api\/image-editor\/sessions\/([^/]+)\/operations$/);
      if (method === "POST" && operationMatch) {
        if (!body.operation || typeof body.operation !== "object") return fail("EDIT_OPERATION_REQUIRED");
        return ok(await service.upsertOperation({ sessionId: operationMatch[1], operation: body.operation as never, summary: typeof body.summary === "string" ? body.summary : undefined }), 200);
      }
      const ocrMatch = path.match(/^\/api\/image-editor\/sessions\/([^/]+)\/ocr$/);
      if (method === "GET" && ocrMatch) { const sourceVersionId = typeof body.sourceVersionId === "string" ? body.sourceVersionId : ""; return sourceVersionId ? ok(await service.getOcrSnapshot(ocrMatch[1], sourceVersionId)) : fail("SOURCE_VERSION_REQUIRED"); }
      if (method === "POST" && ocrMatch) { const sourceVersionId = typeof body.sourceVersionId === "string" ? body.sourceVersionId : ""; if (!sourceVersionId) return fail("SOURCE_VERSION_REQUIRED"); try { return ok(await service.recognize(ocrMatch[1], sourceVersionId), 202); } catch (error) { return fail(error instanceof Error ? error.message : "OCR_FAILED", 409); } }
      const removeMatch = path.match(/^\/api\/image-editor\/sessions\/([^/]+)\/operations\/([^/]+)$/);
      if (method === "DELETE" && removeMatch) { const draft = await service.removeOperation(removeMatch[1], removeMatch[2]); return draft ? ok(draft) : fail("EDIT_OPERATION_NOT_FOUND", 404); }
      const submitMatch = path.match(/^\/api\/image-editor\/sessions\/([^/]+)\/submit$/);
      if (method === "POST" && submitMatch) {
        if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
        try {
          const result = await service.submit({ sessionId: submitMatch[1], idempotencyKey, sourceCardId: String(body.sourceCardId ?? ""), sourceVersionId: String(body.sourceVersionId ?? ""), parentVersionId: typeof body.parentVersionId === "string" ? body.parentVersionId : undefined, summary: typeof body.summary === "string" ? body.summary : undefined });
          return ok(result, result.duplicate ? 200 : 202);
        } catch (error) { return fail(error instanceof Error ? error.message : "IMAGE_EDIT_SUBMIT_FAILED", 409); }
      }
      const retryMatch = path.match(/^\/api\/image-editor\/attempts\/([^/]+)\/retry$/);
      if (method === "POST" && retryMatch) { if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY"); try { const result = await service.retry(retryMatch[1], idempotencyKey); return ok(result, result.duplicate ? 200 : 202); } catch (error) { return fail(error instanceof Error ? error.message : "IMAGE_EDIT_RETRY_FAILED", 409); } }
      const regenerateMatch = path.match(/^\/api\/image-editor\/tasks\/([^/]+)\/regenerate$/);
      if (method === "POST" && regenerateMatch) {
        if (!idempotencyKey) return fail("MISSING_IDEMPOTENCY_KEY");
        try {
          const result = await service.regenerate({ childTaskId: regenerateMatch[1], idempotencyKey, summary: typeof body.summary === "string" ? body.summary : undefined });
          return ok(result, result.duplicate ? 200 : 202);
        } catch (error) { return fail(error instanceof Error ? error.message : "IMAGE_EDIT_REGENERATE_FAILED", 409); }
      }
      const selectMatch = path.match(/^\/api\/image-editor\/tasks\/([^/]+)\/versions\/([^/]+)\/select$/);
      if (method === "POST" && selectMatch) { const selection = body.selection === "final" ? "final" : body.selection === "current" ? "current" : null; if (!selection) return fail("INVALID_VERSION_SELECTION"); try { const version = await service.selectVersion(selectMatch[1], selectMatch[2], selection); return version ? ok(version) : fail("INVALID_IMAGE_EDIT_VERSION", 404); } catch (error) { return fail(error instanceof Error ? error.message : "VERSION_NOT_ELIGIBLE_FOR_FINAL", 409); } }
      return fail("NOT_FOUND", 404);
    },
  };
}

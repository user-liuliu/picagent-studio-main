import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { Client as MinioClient } from "minio";
import { Pool } from "pg";
import { createTicket02App } from "./app.js";
import { loadServerConfig } from "./config.js";
import { runMigrations } from "./migrations.js";
import { decodeMultipartFilename, parseMultipartFile } from "./multipart.js";
import { GptImageProvider } from "./providers/gpt-image-provider.js";
import { DashScopeLlmClient } from "./providers/dashscope-llm-client.js";
import { PostgresPlanRepository } from "./repositories/postgres-plan-repository.js";
import { PostgresCategoryPromptRepository } from "./repositories/postgres-category-prompt-repository.js";
import { PostgresPlatformRepository } from "./repositories/postgres-platform-repository.js";
import { PostgresRagClient } from "./repositories/postgres-rag-client.js";
import { PostgresSuiteRepository } from "./repositories/postgres-suite-repository.js";
import { PostgresTaskRepository } from "./repositories/postgres-task-repository.js";
import { PostgresPromptRepository } from "./repositories/postgres-prompt-repository.js";
import { PostgresLibraryRepository } from "./repositories/postgres-library-repository.js";
import { PostgresReverseRepository } from "./repositories/postgres-reverse-repository.js";
import { MinioStorage } from "./storage/minio-storage.js";
import { ImageEditorService, type ImageEditProvider, type ImageSource } from "./image-editor.js";
import { createImageEditorApi } from "./image-editor-api.js";
import { PostgresImageEditorRepository } from "./repositories/postgres-image-editor-repository.js";
import { DashScopeOcrProvider } from "./providers/dashscope-ocr-provider.js";
import sharp from "sharp";
import { initializeObservability, shutdownObservability } from "./observability.js";

const config = loadServerConfig();
initializeObservability();
const pool = new Pool({ ...config.postgres, max: 6, connectionTimeoutMillis: 30_000, idleTimeoutMillis: 60_000 });
const minio = new MinioClient(config.minio);
await pool.query("SELECT 1");
await runMigrations(pool, { recoverStaleAttempts: true });
try {
  if (!(await minio.bucketExists(config.minio.bucket))) await minio.makeBucket(config.minio.bucket, config.minio.region);
} catch {
  console.warn("MinIO bucket readiness check failed; ask an administrator to create the configured bucket or grant bucket permissions.");
}
const storage = new MinioStorage(minio, config.minio.bucket, 300, config.minio.legacyBucket);
const imageProvider = new GptImageProvider(config.imageGeneration.baseUrl, config.imageGeneration.apiKey, config.imageGeneration.timeoutMs);
const ocrProvider = config.llm ? new DashScopeOcrProvider(config.llm.baseUrl, config.llm.apiKey, config.llm.model, config.llm.timeoutMs) : undefined;
const imageEditorProvider: ImageEditProvider = {
  name: "openai-compatible-image",
  version: "gpt-image-2",
  capabilitiesVersion: "v1",
  capabilities: () => ({
    imageToImage: process.env.IMAGE_EDITOR_IMAGE_TO_IMAGE !== "false",
    addText: process.env.IMAGE_EDITOR_ADD_TEXT !== "false",
    changeText: process.env.IMAGE_EDITOR_CHANGE_TEXT !== "false",
    redraw: process.env.IMAGE_EDITOR_REDRAW !== "false",
    erase: process.env.IMAGE_EDITOR_ERASE !== "false",
    outpaint: process.env.IMAGE_EDITOR_OUTPAINT !== "false",
    currentVersionInput: process.env.IMAGE_EDITOR_CURRENT_VERSION !== "false",
  }),
  edit: async (command, source) => {
    const structuredInstructions = command.operations.map((operation) => {
      if (operation.type === "add_text") return `新增文字“${String(operation.payload.text ?? "")}”，区域与样式参数：${JSON.stringify(operation.payload)}`;
      if (operation.type === "change_text") return `将区域 ${JSON.stringify(operation.payload.region)} 内的原文字“${String(operation.payload.originalText ?? "")}”替换为“${String(operation.payload.newText ?? "")}”，保留原有排版。`;
      if (operation.type === "outpaint") return `按方向 ${String(operation.payload.direction ?? "all")} 扩展到目标比例 ${String(operation.payload.targetRatio ?? "original")}，保持主体位置与风格。`;
      if (operation.type === "redraw") return `仅重绘蒙版白色区域，蒙版外保持不变。操作参数：${JSON.stringify(operation.payload)}`;
      if (operation.type === "erase") return `仅消除蒙版白色区域并修复背景，蒙版外保持不变。操作参数：${JSON.stringify(operation.payload)}`;
      return String(operation.payload.instruction ?? operation.summary);
    }).join("\n");
    const maskedOperations = command.operations.filter((operation) => operation.type === "redraw" || operation.type === "erase");
    if (maskedOperations.length > 1) throw new Error("MULTIPLE_MASK_OPERATIONS_UNSUPPORTED");
    const masked = maskedOperations[0];
    let mask: Buffer | undefined;
    if (masked) {
      const metadata = masked.payload.mask;
      if (!metadata || typeof metadata !== "object" || typeof (metadata as Record<string, unknown>).objectKey !== "string") throw new Error("MASK_SNAPSHOT_REQUIRED");
      const stored = await storage.get((metadata as Record<string, string>).objectKey);
      if (!stored || stored.contentType !== "image/png") throw new Error("MASK_OBJECT_NOT_FOUND");
      mask = stored.bytes;
    }
    const result = await imageProvider.edit({ requestId: randomUUID(), flow: "image-editor", endpoint: "/v1/images/edits", image: source.bytes, imageMimeType: source.mimeType, imageFilename: "source.png", model: "gpt-image-2", prompt: `${command.prompt}\n\n结构化编辑指令：\n${structuredInstructions}`, size: "1K", quality: "medium", n: 1, responseFormat: "b64_json", mask, maskMimeType: mask ? "image/png" : undefined, maskFilename: mask ? "mask.png" : undefined });
    const metadata = await sharp(result.bytes).metadata();
    return { bytes: result.bytes, mimeType: result.mimeType, width: metadata.width ?? source.width, height: metadata.height ?? source.height };
  },
};
const taskRepository = new PostgresTaskRepository(pool);
const frozenPrompt = (snapshot: Record<string, unknown> | null | undefined) => {
  const value = snapshot?.finalPrompt ?? snapshot?.prompt;
  return typeof value === "string" ? value : "";
};
const resolveImageSource = async (versionId: string): Promise<ImageSource | null> => {
  const editVersion = await pool.query<{ objectKey: string; width: number; height: number; mimeType: string; generationPrompt: string }>(`SELECT v.object_key AS "objectKey", v.width, v.height, v.mime_type AS "mimeType", COALESCE(a.command_json->>'prompt','') AS "generationPrompt" FROM suite_workbench.image_edit_versions v JOIN suite_workbench.image_edit_attempts a ON a.id=v.attempt_id WHERE v.id=$1`, [versionId]);
  if (editVersion.rows[0]) {
    const object = await storage.get(editVersion.rows[0].objectKey);
    if (object) return { bytes: object.bytes, mimeType: editVersion.rows[0].mimeType, width: editVersion.rows[0].width, height: editVersion.rows[0].height, generationPrompt: editVersion.rows[0].generationPrompt };
  }
  for (const suite of await new PostgresSuiteRepository(pool).listSuites()) {
    for (const task of await taskRepository.listTasks(suite.id)) {
      const history = await taskRepository.listTaskVersions(task.id);
      const version = history.versions.find((item) => item.id === versionId);
      if (!version) continue;
      const object = await storage.get(version.objectKey);
      if (!object) return null;
      return { bytes: object.bytes, mimeType: object.contentType, width: version.width, height: version.height, generationPrompt: frozenPrompt(version.promptSnapshot) };
    }
  }
  return null;
};
const validateImageEditSource = async (sourceCardId: string, sourceVersionId: string) => {
  const result = await pool.query<{ valid: boolean }>(`SELECT EXISTS (SELECT 1 FROM suite_workbench.suite_tasks t JOIN suite_workbench.task_image_versions v ON v.task_id=t.id WHERE t.id=$1 AND v.id=$2) OR EXISTS (SELECT 1 FROM suite_workbench.image_edit_child_tasks c JOIN suite_workbench.image_edit_versions v ON v.child_task_id=c.id WHERE c.id=$1 AND v.id=$2) AS valid`, [sourceCardId, sourceVersionId]);
  return Boolean(result.rows[0]?.valid);
};
const imageEditorApi = createImageEditorApi(new ImageEditorService(new PostgresImageEditorRepository(pool), imageEditorProvider, storage, resolveImageSource, ocrProvider, validateImageEditSource));
const app = createTicket02App({
  repository: new PostgresSuiteRepository(pool),
  storage,
  provider: new GptImageProvider(config.imageGeneration.baseUrl, config.imageGeneration.apiKey, config.imageGeneration.timeoutMs),
  promptRepository: new PostgresPromptRepository(pool),
  platformRepository: new PostgresPlatformRepository(pool),
  planRepository: new PostgresPlanRepository(pool),
  categoryPromptRepository: new PostgresCategoryPromptRepository(pool),
  taskRepository,
  imageEditorApi,
  libraryRepository: new PostgresLibraryRepository(pool),
  reverseRepository: new PostgresReverseRepository(pool),
  ragClient: new PostgresRagClient(pool),
  llmClient: config.llm ? new DashScopeLlmClient(config.llm.baseUrl, config.llm.apiKey, config.llm.model, config.llm.timeoutMs) : undefined,
});
const staticRoot = resolve(process.cwd(), "dist");
const staticMime: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
async function serveStatic(pathname: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const relativePath = pathname === "/" || !extname(pathname) ? "index.html" : pathname.replace(/^\/+/, "");
  const target = resolve(staticRoot, relativePath);
  if (target !== staticRoot && !target.startsWith(`${staticRoot}\\`) && !target.startsWith(`${staticRoot}/`)) return null;
  try {
    return { bytes: await readFile(target), contentType: staticMime[extname(target).toLowerCase()] ?? "application/octet-stream" };
  } catch { return null; }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = requestUrl.pathname + requestUrl.search;
  const headers = req.headers as Record<string, string | undefined>;
  let response;
  if (req.method === "POST" && path.endsWith("/input-images")) {
    const suiteId = path.split("/")[3];
    const contentType = headers["content-type"] ?? "";
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
    if (!boundary) response = { status: 400, body: { error: { code: "INVALID_MULTIPART", message: "上传请求格式无效" }, requestId: "" } };
    else {
      const raw = body.toString("latin1"); const part = raw.split(`--${boundary}`).find((value) => value.includes("filename="));
      const match = part?.match(/(?:filename\*=[^']*''([^;\r\n]+)|filename="([^"]+)")[\s\S]*?Content-Type:\s*([^\r\n]+)[\r\n]+\r\n([\s\S]*?)\r\n$/i);
      if (!match) response = { status: 400, body: { error: { code: "INVALID_MULTIPART", message: "未找到图片文件" }, requestId: "" } };
      else {
        const encodedFilename = match[1];
        const filename = decodeMultipartFilename(encodedFilename, match[2]);
        response = await app.upload(suiteId, { filename, mimeType: match[3], bytes: Buffer.from(match[4], "latin1"), idempotencyKey: headers["idempotency-key"] });
      }
    }
  } else if (req.method === "POST" && /^\/api\/reverse-plans\/[^/]+\/references$/.test(path)) {
    const parsed = parseMultipartFile(body, headers["content-type"] ?? "");
    if (!parsed) response = { status: 400, body: { error: { code: "INVALID_MULTIPART", message: "未找到图片文件" }, requestId: "" } };
    else {
      response = await app.request("POST", path, { headers: headers as Record<string, string>, body: { filename: parsed.filename, mimeType: parsed.mimeType, bytesBase64: parsed.bytes.toString("base64") } });
    }
  } else if (req.method === "GET" && path.includes("/preview")) {
    const inputMatch = path.match(/^\/api\/suites\/([^/]+)\/input-images\/([^/]+)\/preview\/(original|thumbnail)$/);
    const baseMatch = path.match(/^\/api\/suites\/([^/]+)\/input-images\/([^/]+)\/base-versions\/([^/]+)\/preview$/);
    const taskMatch = path.match(/^\/api\/suite-tasks\/([^/]+)\/versions\/([^/]+)\/preview$/);
    const editTaskMatch = path.match(/^\/api\/image-editor\/tasks\/([^/]+)\/versions\/([^/]+)\/preview$/);
    const libraryMatch = path.match(/^\/api\/library\/resources\/([^/]+)\/preview$/);
    const reverseMatch = path.match(/^\/api\/reverse-plans\/([^/]+)\/references\/([^/]+)\/preview(?:\/(original|thumbnail))?$/);
    response = inputMatch
      ? await app.preview(inputMatch[1], inputMatch[2], inputMatch[3] as "original" | "thumbnail")
      : baseMatch
        ? await app.previewBaseVersion(baseMatch[1], baseMatch[2], baseMatch[3])
      : editTaskMatch
        ? await (async () => { const found = await pool.query<{ objectKey: string; mimeType: string }>("SELECT v.object_key AS \"objectKey\", v.mime_type AS \"mimeType\" FROM suite_workbench.image_edit_versions v WHERE v.child_task_id=$1 AND v.id=$2", [editTaskMatch[1], editTaskMatch[2]]); if (!found.rows[0]) return { status: 404, body: { error: { code: "NOT_FOUND", message: "请求不存在" }, requestId: "" } }; const object = await storage.get(found.rows[0].objectKey); return object ? { status: 200, raw: object.bytes, headers: { "content-type": found.rows[0].mimeType } } : { status: 404, body: { error: { code: "NOT_FOUND", message: "请求不存在" }, requestId: "" } }; })()
      : taskMatch
        ? await app.previewTaskVersion(taskMatch[1], taskMatch[2])
        : libraryMatch
          ? await app.previewLibraryResource(libraryMatch[1])
        : reverseMatch
          ? await app.previewReverseReference(reverseMatch[1], reverseMatch[2], (reverseMatch[3] as "original" | "thumbnail" | undefined) ?? "thumbnail")
        : { status: 404, body: { error: { code: "NOT_FOUND", message: "请求不存在" }, requestId: "" } };
    if ((response.headers as Record<string, string> | undefined)?.location) { res.statusCode = response.status; res.setHeader("location", (response.headers as Record<string, string>).location); res.end(); return; }
    if (response.raw) { const rawHeaders = response.headers as Record<string, string> | undefined; res.statusCode = response.status; for (const [name, value] of Object.entries(rawHeaders ?? {})) res.setHeader(name, value); res.setHeader("content-type", rawHeaders?.["content-type"] ?? "application/octet-stream"); res.setHeader("cache-control", rawHeaders?.["cache-control"] ?? "private, max-age=60"); res.end(response.raw); return; }
  } else if (req.method === "GET" && !path.startsWith("/api/")) {
    const asset = await serveStatic(requestUrl.pathname);
    if (asset) { res.statusCode = 200; res.setHeader("content-type", asset.contentType); res.end(asset.bytes); return; }
    const fallback = await serveStatic("/");
    if (fallback) { res.statusCode = 200; res.setHeader("content-type", fallback.contentType); res.end(fallback.bytes); return; }
    response = { status: 404, body: { error: { code: "NOT_FOUND", message: "请求不存在" }, requestId: "" } };
  } else {
    let parsed: unknown; try { parsed = body.length ? JSON.parse(body.toString("utf8")) : undefined; } catch { parsed = undefined; }
    response = await app.request(req.method ?? "GET", path, { headers: headers as Record<string, string>, body: parsed });
  }
  res.statusCode = response.status; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(response.body));
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("Unhandled API request error", error instanceof Error ? error.message : error);
    if (res.headersSent) { res.destroy(); return; }
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请重试" }, requestId: "" }));
  });
});

server.listen(config.port, process.env.HOST?.trim() || "127.0.0.1", () => console.log("PicAgent suite API connected to PostgreSQL and MinIO"));
async function shutdown() { server.close(); await shutdownObservability(); await pool.end(); }
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

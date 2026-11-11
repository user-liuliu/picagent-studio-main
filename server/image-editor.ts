import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { StorageAdapter } from "./types.js";

export const IMAGE_EDIT_TOOLS = ["re_edit", "regenerate", "add_text", "change_text", "redraw", "erase", "outpaint"] as const;
export type ImageEditTool = (typeof IMAGE_EDIT_TOOLS)[number];
export type ImageEditOperationType = Exclude<ImageEditTool, "regenerate">;

export type EditStatus = "draft" | "queued" | "generating" | "succeeded" | "failed";
export interface NormalizedRect { x: number; y: number; width: number; height: number; rotation?: number }
export interface NormalizedStroke { mode?: "draw" | "erase"; points: Array<{ x: number; y: number }>; width: number }
export interface MaskSnapshot { width: number; height: number; mimeType: "image/png"; sha256: string; objectKey: string; feather: number; strokes: NormalizedStroke[] }
export interface OcrTextBlock { id: string; text: string; confidence: number; bounds: NormalizedRect; rotation: number }
export interface OcrSnapshot { sourceVersionId: string; status: "succeeded" | "failed"; blocks: OcrTextBlock[]; error?: string }
export interface OutpaintSpec { direction: "all" | "horizontal" | "vertical" | "left" | "right"; targetRatio: "original" | "1:1" | "3:4" | "4:3" | "9:16" | "16:9"; targetWidth: number; targetHeight: number; anchor: "center" | "left" | "right" }

export interface EditOperation {
  operationId: string;
  type: ImageEditOperationType;
  order: number;
  sourceCardId: string;
  sourceVersionId: string;
  parentVersionId: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface EditSnapshot {
  id: string;
  sourceCardId: string;
  sourceVersionId: string;
  parentVersionId: string;
  summary: string;
  sourcePrompt: string;
  operations: ReadonlyArray<EditOperation>;
  provider: { name: string; version: string; capabilitiesVersion: string };
  createdAt: string;
  schemaVersion: "image-edit-snapshot-v1";
}

export interface ImageEditChildTask {
  id: string;
  sourceCardId: string;
  sourceVersionId: string;
  parentVersionId: string;
  snapshotId: string;
  summary: string;
  status: EditStatus;
  currentVersionId: string | null;
  finalVersionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImageEditAttempt {
  id: string;
  childTaskId: string;
  snapshotId: string;
  attemptNo: number;
  status: Exclude<EditStatus, "draft" | "queued">;
  command: ImageEditCommand;
  provider: { name: string; version: string; capabilitiesVersion: string };
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImageEditVersion {
  id: string;
  childTaskId: string;
  attemptId: string;
  versionNumber: number;
  objectKey: string;
  sha256: string;
  width: number;
  height: number;
  mimeType: string;
  createdAt: string;
}

export interface ImageEditCommand {
  type: ImageEditOperationType;
  sourceVersionId: string;
  prompt: string;
  operations: ReadonlyArray<EditOperation>;
}

export interface ImageEditProviderCapabilities {
  imageToImage: boolean;
  addText: boolean;
  changeText: boolean;
  redraw: boolean;
  erase: boolean;
  outpaint: boolean;
  currentVersionInput: boolean;
  ocr?: boolean;
}

export interface ImageEditProvider {
  name: string;
  version: string;
  capabilitiesVersion: string;
  capabilities(): Promise<ImageEditProviderCapabilities> | ImageEditProviderCapabilities;
  edit(command: ImageEditCommand, source: { bytes: Buffer; mimeType: string; width: number; height: number }): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number }>;
}

export interface OcrProvider {
  name: string;
  version: string;
  recognize(source: ImageSource): Promise<{ blocks: OcrTextBlock[] }>;
}

export interface ImageSource { bytes: Buffer; mimeType: string; width: number; height: number; generationPrompt?: string }

const OUTPAINT_RATIOS: Record<OutpaintSpec["targetRatio"], number | null> = {
  original: null,
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
};

function outpaintDimensions(source: Pick<ImageSource, "width" | "height">, direction: OutpaintSpec["direction"], targetRatio: OutpaintSpec["targetRatio"]) {
  const sourceRatio = source.width / source.height;
  const ratio = OUTPAINT_RATIOS[targetRatio] ?? sourceRatio;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("OUTPAINT_TARGET_RATIO_INVALID");
  if (targetRatio === "original") return { targetWidth: source.width, targetHeight: source.height, anchor: direction === "left" ? "left" : direction === "right" ? "right" : "center" as const };
  if (sourceRatio < ratio) return { targetWidth: Math.max(source.width, Math.ceil(source.height * ratio)), targetHeight: source.height, anchor: direction === "left" ? "left" : direction === "right" ? "right" : "center" as const };
  return { targetWidth: source.width, targetHeight: Math.max(source.height, Math.ceil(source.width / ratio)), anchor: direction === "left" ? "left" : direction === "right" ? "right" : "center" as const };
}

async function renderMaskPng(source: Pick<ImageSource, "width" | "height">, strokes: NormalizedStroke[], feather: number) {
  const paths = strokes.map((stroke) => {
    const points = stroke.points.map((point) => `${point.x * source.width},${point.y * source.height}`).join(" ");
    const width = Math.max(1, stroke.width * Math.min(source.width, source.height));
    const color = stroke.mode === "erase" ? "black" : "white";
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      return `<circle cx="${point.x * source.width}" cy="${point.y * source.height}" r="${width / 2}" fill="${color}"/>`;
    }
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}"><rect width="100%" height="100%" fill="black"/>${paths}</svg>`;
  const rendered = await sharp(Buffer.from(svg)).removeAlpha().grayscale().raw().toBuffer({ resolveWithObject: true });
  const sigma = feather > 0 ? Math.max(0.3, feather * Math.min(source.width, source.height) / 12) : undefined;
  const output = sharp(rendered.data, { raw: { width: rendered.info.width, height: rendered.info.height, channels: 1 } }).toColourspace("b-w");
  if (sigma) output.blur(sigma);
  return output.png().toBuffer();
}

export interface ImageEditorRepository {
  getDraft(sessionId: string): Promise<{ sessionId: string; operations: EditOperation[]; summary: string } | null>;
  saveDraft(draft: { sessionId: string; operations: EditOperation[]; summary: string }): Promise<void>;
  getSnapshot(id: string): Promise<EditSnapshot | null>;
  getChildTask(id: string): Promise<ImageEditChildTask | null>;
  listChildTasks(): Promise<ImageEditChildTask[]>;
  listChildTasksBySourceCard(sourceCardId: string): Promise<ImageEditChildTask[]>;
  getOcrSnapshot(sessionId: string, sourceVersionId: string): Promise<OcrSnapshot | null>;
  saveOcrSnapshot(sessionId: string, snapshot: OcrSnapshot): Promise<void>;
  getAttempt(id: string): Promise<ImageEditAttempt | null>;
  submit(input: { idempotencyKey: string; snapshot: EditSnapshot; childTask: ImageEditChildTask; attempt: ImageEditAttempt }): Promise<{ snapshot: EditSnapshot; childTask: ImageEditChildTask; attempt: ImageEditAttempt; duplicate: boolean }>;
  appendAttempt?(input: { idempotencyKey: string; snapshot: EditSnapshot; childTask: ImageEditChildTask; attempt: ImageEditAttempt }): Promise<{ snapshot: EditSnapshot; childTask: ImageEditChildTask; attempt: ImageEditAttempt; duplicate: boolean }>;
  completeAttempt(input: { attemptId: string; objectKey: string; sha256: string; width: number; height: number; mimeType: string; completedAt: string }): Promise<{ attempt: ImageEditAttempt; version: ImageEditVersion; childTask: ImageEditChildTask }>;
  failAttempt(attemptId: string, code: string, message: string, completedAt: string): Promise<{ attempt: ImageEditAttempt; childTask: ImageEditChildTask }>;
  listAttempts(childTaskId: string): Promise<ImageEditAttempt[]>;
  listVersions(childTaskId: string): Promise<ImageEditVersion[]>;
  selectVersion(childTaskId: string, versionId: string, selection: "current" | "final"): Promise<ImageEditVersion | null>;
}

export class MemoryImageEditorRepository implements ImageEditorRepository {
  private drafts = new Map<string, { sessionId: string; operations: EditOperation[]; summary: string }>();
  private snapshots = new Map<string, EditSnapshot>();
  private tasks = new Map<string, ImageEditChildTask>();
  private attempts = new Map<string, ImageEditAttempt>();
  private versions = new Map<string, ImageEditVersion>();
  private idempotency = new Map<string, { snapshotId: string; childTaskId: string; attemptId: string }>();
  private ocr = new Map<string, OcrSnapshot>();
  async getDraft(id: string) { const draft = this.drafts.get(id); return draft ? structuredClone(draft) : null; }
  async saveDraft(draft: { sessionId: string; operations: EditOperation[]; summary: string }) { this.drafts.set(draft.sessionId, structuredClone(draft)); }
  async getSnapshot(id: string) { const snapshot = this.snapshots.get(id); return snapshot ? structuredClone(snapshot) : null; }
  async getChildTask(id: string) { const task = this.tasks.get(id); return task ? structuredClone(task) : null; }
  async listChildTasks() { return [...this.tasks.values()].map((task) => structuredClone(task)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async listChildTasksBySourceCard(sourceCardId: string) { return [...this.tasks.values()].filter((task) => task.sourceCardId === sourceCardId).map((task) => structuredClone(task)); }
  async getOcrSnapshot(sessionId: string, sourceVersionId: string) { const value = this.ocr.get(`${sessionId}:${sourceVersionId}`); return value ? structuredClone(value) : null; }
  async saveOcrSnapshot(sessionId: string, snapshot: OcrSnapshot) { this.ocr.set(`${sessionId}:${snapshot.sourceVersionId}`, structuredClone(snapshot)); }
  async getAttempt(id: string) { const attempt = this.attempts.get(id); return attempt ? structuredClone(attempt) : null; }
  async submit(input: { idempotencyKey: string; snapshot: EditSnapshot; childTask: ImageEditChildTask; attempt: ImageEditAttempt }) {
    const old = this.idempotency.get(input.idempotencyKey);
    if (old) return { snapshot: this.snapshots.get(old.snapshotId)!, childTask: this.tasks.get(old.childTaskId)!, attempt: this.attempts.get(old.attemptId)!, duplicate: true };
    this.snapshots.set(input.snapshot.id, structuredClone(input.snapshot));
    this.tasks.set(input.childTask.id, structuredClone(input.childTask));
    this.attempts.set(input.attempt.id, structuredClone(input.attempt));
    this.idempotency.set(input.idempotencyKey, { snapshotId: input.snapshot.id, childTaskId: input.childTask.id, attemptId: input.attempt.id });
    return { ...input, duplicate: false };
  }
  async appendAttempt(input: { idempotencyKey: string; snapshot: EditSnapshot; childTask: ImageEditChildTask; attempt: ImageEditAttempt }) {
    const old = this.idempotency.get(input.idempotencyKey);
    if (old) return { snapshot: this.snapshots.get(old.snapshotId)!, childTask: this.tasks.get(old.childTaskId)!, attempt: this.attempts.get(old.attemptId)!, duplicate: true };
    if (!this.snapshots.has(input.snapshot.id) || !this.tasks.has(input.childTask.id)) throw new Error("INVALID_IMAGE_EDIT_TASK");
    const attemptNo = [...this.attempts.values()].filter((item) => item.childTaskId === input.childTask.id).reduce((max, item) => Math.max(max, item.attemptNo), 0) + 1;
    const attempt = { ...input.attempt, attemptNo };
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.tasks.set(input.childTask.id, structuredClone(input.childTask));
    this.idempotency.set(input.idempotencyKey, { snapshotId: input.snapshot.id, childTaskId: input.childTask.id, attemptId: attempt.id });
    return { snapshot: input.snapshot, childTask: input.childTask, attempt, duplicate: false };
  }
  async completeAttempt(input: { attemptId: string; objectKey: string; sha256: string; width: number; height: number; mimeType: string; completedAt: string }) {
    const attempt = this.attempts.get(input.attemptId); if (!attempt || attempt.status !== "generating") throw new Error("INVALID_IMAGE_EDIT_ATTEMPT");
    const task = this.tasks.get(attempt.childTaskId); if (!task) throw new Error("INVALID_IMAGE_EDIT_TASK");
    const versions = await this.listVersions(task.id); const version: ImageEditVersion = { id: randomUUID(), childTaskId: task.id, attemptId: attempt.id, versionNumber: versions.length + 1, objectKey: input.objectKey, sha256: input.sha256, width: input.width, height: input.height, mimeType: input.mimeType, createdAt: input.completedAt };
    this.versions.set(version.id, version);
    const done = { ...attempt, status: "succeeded" as const, completedAt: input.completedAt }; this.attempts.set(attempt.id, done);
    const updated = { ...task, status: "succeeded" as const, currentVersionId: version.id, updatedAt: input.completedAt }; this.tasks.set(task.id, updated);
    return { attempt: done, version, childTask: updated };
  }
  async failAttempt(id: string, code: string, message: string, completedAt: string) {
    const attempt = this.attempts.get(id); if (!attempt) throw new Error("INVALID_IMAGE_EDIT_ATTEMPT"); const task = this.tasks.get(attempt.childTaskId); if (!task) throw new Error("INVALID_IMAGE_EDIT_TASK");
    const failed = { ...attempt, status: "failed" as const, errorCode: code, errorMessage: message, completedAt }; this.attempts.set(id, failed);
    const updated = { ...task, status: "failed" as const, errorCode: code, errorMessage: message, updatedAt: completedAt }; this.tasks.set(task.id, updated); return { attempt: failed, childTask: updated };
  }
  async listAttempts(childTaskId: string) { return [...this.attempts.values()].filter((a) => a.childTaskId === childTaskId).sort((a, b) => a.attemptNo - b.attemptNo); }
  async listVersions(childTaskId: string) { return [...this.versions.values()].filter((v) => v.childTaskId === childTaskId).sort((a, b) => b.versionNumber - a.versionNumber); }
  async selectVersion(childTaskId: string, versionId: string, selection: "current" | "final") { const version = this.versions.get(versionId); if (!version || version.childTaskId !== childTaskId) return null; const task = this.tasks.get(childTaskId); if (!task) return null; if (selection === "final") { const attempt = this.attempts.get(version.attemptId); if (!attempt || attempt.status !== "succeeded") throw new Error("VERSION_NOT_ELIGIBLE_FOR_FINAL"); }
    if (selection === "current") this.tasks.set(childTaskId, { ...task, currentVersionId: version.id, updatedAt: new Date().toISOString() }); else this.tasks.set(childTaskId, { ...task, finalVersionId: version.id, updatedAt: new Date().toISOString() }); return version;
  }
}

export class ImageEditorService {
  constructor(private readonly repository: ImageEditorRepository, private readonly provider: ImageEditProvider, private readonly storage: StorageAdapter, private readonly resolveSource: (versionId: string) => Promise<ImageSource | null>, private readonly ocrProvider?: OcrProvider, private readonly validateSource?: (sourceCardId: string, sourceVersionId: string) => Promise<boolean>) {}
  async capabilities() { return { provider: { name: this.provider.name, version: this.provider.version, capabilitiesVersion: this.provider.capabilitiesVersion }, capabilities: { ...(await this.provider.capabilities()), ocr: Boolean(this.ocrProvider) } }; }
  async getDraft(sessionId: string) { return this.repository.getDraft(sessionId); }
  async recognize(sessionId: string, sourceVersionId: string) { if (!this.ocrProvider) throw new Error("OCR_PROVIDER_UNAVAILABLE"); const source = await this.resolveSource(sourceVersionId); if (!source) throw new Error("SOURCE_VERSION_NOT_FOUND"); try { const snapshot: OcrSnapshot = { sourceVersionId, status: "succeeded", blocks: await this.ocrProvider.recognize(source).then((result) => result.blocks) }; await this.repository.saveOcrSnapshot(sessionId, snapshot); return snapshot; } catch (error) { const snapshot: OcrSnapshot = { sourceVersionId, status: "failed", blocks: [], error: error instanceof Error ? error.message : "OCR_FAILED" }; await this.repository.saveOcrSnapshot(sessionId, snapshot); return snapshot; } }
  async getOcrSnapshot(sessionId: string, sourceVersionId: string) { return this.repository.getOcrSnapshot(sessionId, sourceVersionId); }
  async upsertOperation(input: { sessionId: string; operation: EditOperation; summary?: string }) { const draft = await this.repository.getDraft(input.sessionId) ?? { sessionId: input.sessionId, operations: [], summary: "" }; const index = draft.operations.findIndex((item) => item.operationId === input.operation.operationId); const operations = [...draft.operations]; if (index >= 0) operations[index] = input.operation; else operations.push(input.operation); operations.forEach((item, i) => { item.order = i + 1; }); await this.repository.saveDraft({ ...draft, operations, summary: input.summary ?? draft.summary }); return { sessionId: input.sessionId, operations, summary: input.summary ?? draft.summary }; }
  async removeOperation(sessionId: string, operationId: string) { const draft = await this.repository.getDraft(sessionId); if (!draft) return null; const operations = draft.operations.filter((item) => item.operationId !== operationId).map((item, i) => ({ ...item, order: i + 1 })); await this.repository.saveDraft({ ...draft, operations }); return { ...draft, operations }; }
  async submit(input: { sessionId: string; idempotencyKey: string; sourceCardId: string; sourceVersionId: string; parentVersionId?: string; summary?: string }) {
    if (!input.sourceCardId.trim() || !input.sourceVersionId.trim()) throw new Error("EDIT_SOURCE_VERSION_REQUIRED");
    const draft = await this.repository.getDraft(input.sessionId); if (!draft || !draft.operations.length) throw new Error("EDIT_OPERATIONS_REQUIRED");
    if (this.validateSource && !(await this.validateSource(input.sourceCardId, input.sourceVersionId))) throw new Error("EDIT_SOURCE_NOT_FOUND");
    const source = await this.resolveSource(input.sourceVersionId); if (!source) throw new Error("SOURCE_VERSION_NOT_FOUND");
    const sourcePrompt = source.generationPrompt ?? "";
    const operations = await Promise.all(draft.operations.map(async (operation, i) => {
      const payload = { ...operation.payload };
      if (operation.type === "change_text") {
        const ocr = await this.repository.getOcrSnapshot(input.sessionId, input.sourceVersionId);
        if (!ocr) throw new Error("OCR_REQUIRED");
        if (ocr.status === "failed" && (!payload.originalText || !payload.newText || !payload.region)) throw new Error("CHANGE_TEXT_MANUAL_FIELDS_REQUIRED");
        payload.ocrSnapshot = structuredClone(ocr);
      }
      return { ...operation, order: i + 1, sourceCardId: input.sourceCardId, sourceVersionId: input.sourceVersionId, parentVersionId: input.parentVersionId ?? input.sourceVersionId, payload };
    }));
    const caps = await this.provider.capabilities(); this.assertCapabilities(operations, caps); for (const operation of operations) this.validateOperation(operation);
    const materialized = await Promise.all(operations.map(async (operation) => {
      const payload = { ...operation.payload };
      if (operation.type === "outpaint") {
        const direction = payload.direction;
        const targetRatio = payload.targetRatio;
        if (direction !== "all" && direction !== "horizontal" && direction !== "vertical" && direction !== "left" && direction !== "right") throw new Error("OUTPAINT_DIRECTION_INVALID");
        if (typeof targetRatio !== "string" || !Object.prototype.hasOwnProperty.call(OUTPAINT_RATIOS, targetRatio)) throw new Error("OUTPAINT_TARGET_RATIO_INVALID");
        const dimensions = outpaintDimensions(source, direction, targetRatio as OutpaintSpec["targetRatio"]);
        if (payload.targetWidth !== undefined && Number(payload.targetWidth) !== dimensions.targetWidth) throw new Error("OUTPAINT_TARGET_DIMENSIONS_INVALID");
        if (payload.targetHeight !== undefined && Number(payload.targetHeight) !== dimensions.targetHeight) throw new Error("OUTPAINT_TARGET_DIMENSIONS_INVALID");
        payload.targetWidth = dimensions.targetWidth;
        payload.targetHeight = dimensions.targetHeight;
        payload.anchor = dimensions.anchor;
      }
      if (operation.type === "redraw" || operation.type === "erase") {
        const strokes = operation.payload.strokes as NormalizedStroke[];
        const feather = operation.payload.feather === undefined ? 0 : Number(operation.payload.feather);
        if (!Number.isFinite(feather) || feather < 0 || feather > 1) throw new Error("MASK_FEATHER_INVALID");
        const bytes = await renderMaskPng(source, strokes, feather);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const objectKey = `image-edits/masks/${operation.sourceVersionId}/${operation.operationId}-${sha256}.png`;
        await this.storage.put({ key: objectKey, bytes, contentType: "image/png" });
        payload.feather = feather;
        payload.mask = { width: source.width, height: source.height, mimeType: "image/png", sha256, objectKey, feather, strokes: structuredClone(strokes) } satisfies MaskSnapshot;
      }
      return { ...operation, payload };
    }));
    const summary = input.summary ?? draft.summary;
    const orderedOperations = materialized.sort((a, b) => a.order - b.order);
    const prompt = orderedOperations.length === 1 && orderedOperations[0].type === "re_edit"
      ? String(orderedOperations[0].payload.prompt ?? sourcePrompt)
      : [sourcePrompt, ...orderedOperations.map((operation) => {
      const operationPrompt = typeof operation.payload.prompt === "string" ? operation.payload.prompt.trim() : "";
      const details = [operation.payload.text, operation.payload.originalText, operation.payload.newText].filter((value) => typeof value === "string" && value.trim()).join(" → ");
      return [operation.summary, details, operationPrompt].filter(Boolean).join("：");
    })].filter(Boolean).join("\n");
    const snapshot: EditSnapshot = { id: randomUUID(), sourceCardId: input.sourceCardId, sourceVersionId: input.sourceVersionId, parentVersionId: input.parentVersionId ?? input.sourceVersionId, summary, sourcePrompt, operations: structuredClone(materialized), provider: { name: this.provider.name, version: this.provider.version, capabilitiesVersion: this.provider.capabilitiesVersion }, createdAt: new Date().toISOString(), schemaVersion: "image-edit-snapshot-v1" };
    const taskId = randomUUID(); const now = new Date().toISOString(); const childTask: ImageEditChildTask = { id: taskId, sourceCardId: input.sourceCardId, sourceVersionId: snapshot.sourceVersionId, parentVersionId: snapshot.parentVersionId, snapshotId: snapshot.id, summary: snapshot.summary, status: "generating", currentVersionId: null, finalVersionId: null, errorCode: null, errorMessage: null, createdAt: now, updatedAt: now };
    const attempt: ImageEditAttempt = { id: randomUUID(), childTaskId: taskId, snapshotId: snapshot.id, attemptNo: 1, status: "generating", command: { type: materialized[0].type, sourceVersionId: snapshot.sourceVersionId, prompt, operations: structuredClone(materialized) }, provider: snapshot.provider, errorCode: null, errorMessage: null, createdAt: now, completedAt: null };
    const result = await this.repository.submit({ idempotencyKey: input.idempotencyKey, snapshot, childTask, attempt }); if (!result.duplicate) void this.execute(result.attempt, snapshot);
    return result;
  }
  async retry(attemptId: string, idempotencyKey: string) { const failed = await this.repository.getAttempt(attemptId); if (!failed || failed.status !== "failed") throw new Error("INVALID_IMAGE_EDIT_ATTEMPT"); const task = await this.repository.getChildTask(failed.childTaskId); if (!task) throw new Error("INVALID_IMAGE_EDIT_TASK"); const snapshot = await this.repository.getSnapshot(task.snapshotId); if (!snapshot) throw new Error("INVALID_IMAGE_EDIT_SNAPSHOT"); this.assertCapabilities(snapshot.operations, await this.provider.capabilities()); const oldAttempts = await this.repository.listAttempts(task.id); const attempt: ImageEditAttempt = { ...failed, id: randomUUID(), attemptNo: oldAttempts.length + 1, status: "generating", errorCode: null, errorMessage: null, createdAt: new Date().toISOString(), completedAt: null }; const result = await this.appendAttempt({ idempotencyKey, snapshot, childTask: { ...task, status: "generating", errorCode: null, errorMessage: null, updatedAt: attempt.createdAt }, attempt }); if (!result.duplicate) void this.execute(result.attempt, snapshot); return result; }
  async regenerate(input: { childTaskId: string; idempotencyKey: string; summary?: string }) { const task = await this.repository.getChildTask(input.childTaskId); if (!task) throw new Error("INVALID_IMAGE_EDIT_TASK"); if (!task.currentVersionId) throw new Error("CURRENT_VERSION_REQUIRED"); const snapshot = await this.repository.getSnapshot(task.snapshotId); if (!snapshot) throw new Error("INVALID_IMAGE_EDIT_SNAPSHOT"); const source = await this.resolveSource(task.currentVersionId); if (!source) throw new Error("CURRENT_VERSION_SOURCE_NOT_FOUND"); const operation: EditOperation = { ...snapshot.operations[0], type: "re_edit", sourceVersionId: task.currentVersionId, parentVersionId: task.currentVersionId, summary: input.summary ?? snapshot.summary }; const command: ImageEditCommand = { type: "re_edit", sourceVersionId: task.currentVersionId, prompt: input.summary ?? snapshot.summary, operations: [operation] }; const caps = await this.provider.capabilities(); if (!caps.currentVersionInput || !caps.imageToImage) throw new Error("IMAGE_EDIT_CURRENT_VERSION_UNSUPPORTED"); const attempts = await this.repository.listAttempts(task.id); const attempt: ImageEditAttempt = { id: randomUUID(), childTaskId: task.id, snapshotId: snapshot.id, attemptNo: attempts.length + 1, status: "generating", command, provider: snapshot.provider, errorCode: null, errorMessage: null, createdAt: new Date().toISOString(), completedAt: null }; const result = await this.appendAttempt({ idempotencyKey: input.idempotencyKey, snapshot, childTask: { ...task, status: "generating", updatedAt: attempt.createdAt }, attempt }); if (!result.duplicate) void this.execute(result.attempt, snapshot); return result; }
  async selectVersion(childTaskId: string, versionId: string, selection: "current" | "final") { return this.repository.selectVersion(childTaskId, versionId, selection); }
  async getTask(childTaskId: string) { const task = await this.repository.getChildTask(childTaskId); if (!task) return null; return { task, snapshot: await this.repository.getSnapshot(task.snapshotId), attempts: await this.repository.listAttempts(task.id), versions: await this.repository.listVersions(task.id) }; }
  async listTasksBySourceCard(sourceCardId: string) { const tasks = await this.repository.listChildTasksBySourceCard(sourceCardId); return Promise.all(tasks.map(async (task) => ({ task, snapshot: await this.repository.getSnapshot(task.snapshotId), attempts: await this.repository.listAttempts(task.id), versions: await this.repository.listVersions(task.id) }))); }
  async listAllTasks() { const tasks = await this.repository.listChildTasks(); return Promise.all(tasks.map(async (task) => ({ task, snapshot: await this.repository.getSnapshot(task.snapshotId), attempts: await this.repository.listAttempts(task.id), versions: await this.repository.listVersions(task.id) }))); }
  private validateOperation(operation: EditOperation) {
    if (!operation.sourceVersionId || !operation.parentVersionId) throw new Error("EDIT_SOURCE_VERSION_REQUIRED");
    if (!["re_edit", "add_text", "change_text", "redraw", "erase", "outpaint"].includes(operation.type)) throw new Error("INVALID_IMAGE_EDIT_OPERATION");
    const region = operation.payload.region;
    if (region && typeof region === "object") this.validateRect(region as Record<string, unknown>);
    const prompt = typeof operation.payload.prompt === "string" ? operation.payload.prompt.trim() : "";
    if (["re_edit", "add_text", "change_text", "redraw", "erase"].includes(operation.type) && !prompt) throw new Error(`${operation.type.toUpperCase()}_PROMPT_REQUIRED`);
    if (["redraw", "erase"].includes(operation.type)) {
      if (!Array.isArray(operation.payload.strokes) || !operation.payload.strokes.length) throw new Error("MASK_STROKES_REQUIRED");
      for (const stroke of operation.payload.strokes) {
        if (!stroke || typeof stroke !== "object" || !Array.isArray((stroke as Record<string, unknown>).points)) throw new Error("MASK_STROKES_INVALID");
        const mode = (stroke as Record<string, unknown>).mode; if (mode !== undefined && mode !== "draw" && mode !== "erase") throw new Error("MASK_STROKE_MODE_INVALID");
        const points = (stroke as Record<string, unknown>).points as unknown[];
        if (!points.length) throw new Error("MASK_POINTS_REQUIRED");
        const width = Number((stroke as Record<string, unknown>).width); if (!Number.isFinite(width) || width <= 0 || width > 1) throw new Error("MASK_BRUSH_WIDTH_INVALID");
        for (const point of (stroke as Record<string, unknown>).points as unknown[]) { if (!point || typeof point !== "object") throw new Error("MASK_POINT_INVALID"); const p = point as Record<string, unknown>; if (!this.inUnit(Number(p.x)) || !this.inUnit(Number(p.y))) throw new Error("MASK_POINT_INVALID"); }
      }
      const mask = operation.payload.mask; if (mask && typeof mask === "object") { const value = mask as Record<string, unknown>; if (value.mimeType !== "image/png" || !Number.isInteger(value.width) || !Number.isInteger(value.height)) throw new Error("MASK_METADATA_INVALID"); }
    }
    if (operation.type === "change_text" && (!operation.payload.originalText || !operation.payload.newText || !operation.payload.region)) throw new Error("CHANGE_TEXT_FIELDS_REQUIRED");
  }
  private async appendAttempt(input: { idempotencyKey: string; snapshot: EditSnapshot; childTask: ImageEditChildTask; attempt: ImageEditAttempt }) {
    if (this.repository.appendAttempt) return this.repository.appendAttempt(input);
    return this.repository.submit(input);
  }
  private assertCapabilities(operations: ReadonlyArray<EditOperation>, caps: ImageEditProviderCapabilities) {
    for (const operation of operations) {
      const supported = operation.type === "re_edit" ? caps.imageToImage : operation.type === "add_text" ? caps.addText : operation.type === "change_text" ? caps.changeText : operation.type === "redraw" ? caps.redraw : operation.type === "erase" ? caps.erase : caps.outpaint;
      if (!supported) throw new Error(`IMAGE_EDIT_CAPABILITY_UNSUPPORTED:${operation.type}`);
    }
  }
  private validateRect(rect: Record<string, unknown>) { if (!["x", "y", "width", "height"].every((key) => Number.isFinite(Number(rect[key])))) throw new Error("NORMALIZED_RECT_INVALID"); if (!this.inUnit(Number(rect.x)) || !this.inUnit(Number(rect.y)) || !this.inUnit(Number(rect.width)) || !this.inUnit(Number(rect.height)) || Number(rect.width) <= 0 || Number(rect.height) <= 0 || Number(rect.x) + Number(rect.width) > 1 || Number(rect.y) + Number(rect.height) > 1) throw new Error("NORMALIZED_RECT_INVALID"); }
  private inUnit(value: number) { return Number.isFinite(value) && value >= 0 && value <= 1; }
  private async execute(attempt: ImageEditAttempt, snapshot: EditSnapshot) { try { const source = await this.resolveSource(attempt.command.sourceVersionId); if (!source) throw new Error("SOURCE_VERSION_NOT_FOUND"); const generated = await this.provider.edit(attempt.command, source); const objectKey = `image-edits/${attempt.childTaskId}/versions/${randomUUID()}.png`; await this.storage.put({ key: objectKey, bytes: generated.bytes, contentType: generated.mimeType }); const sha256 = createHash("sha256").update(generated.bytes).digest("hex"); await this.repository.completeAttempt({ attemptId: attempt.id, objectKey, sha256, width: generated.width, height: generated.height, mimeType: generated.mimeType, completedAt: new Date().toISOString() }); } catch (error) { await this.repository.failAttempt(attempt.id, error instanceof Error ? error.message : "IMAGE_EDIT_FAILED", error instanceof Error ? error.message : "IMAGE_EDIT_FAILED", new Date().toISOString()).catch(() => undefined); } }
}

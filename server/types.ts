import type { PromptStage } from "./prompt-library.js";

export type SuiteStatus = "draft" | "in_progress";

export interface Suite {
  id: string;
  name: string;
  status: SuiteStatus;
  createdAt: string;
  updatedAt: string;
}

export interface InputImage {
  id: string;
  suiteId: string;
  ordinal: number;
  originalObjectKey: string;
  thumbnailObjectKey: string;
  sha256: string;
  width: number;
  height: number;
  mimeType: string;
  originalFilename: string;
  currentBaseVersionId: string | null;
  createdAt: string;
  originalPreviewUrl: string;
  thumbnailPreviewUrl: string;
}

export interface SuiteAggregate extends Suite { inputImages: InputImage[] }

export interface UploadFile { filename: string; mimeType: string; bytes: Buffer; ordinal?: number; idempotencyKey?: string }

export interface ResponseEnvelope<T> { data: T; requestId: string }
export interface ErrorEnvelope { error: { code: string; message: string }; requestId: string }

export interface SuiteRepository {
  createSuite(name: string, idempotencyKey?: string): Promise<Suite>;
  listSuites(): Promise<Suite[]>;
  getSuite(id: string): Promise<Suite | null>;
  getInputImages(suiteId: string): Promise<InputImage[]>;
  hasInputImageHash(suiteId: string, sha256: string): Promise<boolean>;
  createInputImage(input: Omit<InputImage, "originalPreviewUrl" | "thumbnailPreviewUrl">, idempotencyKey?: string): Promise<InputImage>;
  removeInputImage(suiteId: string, inputImageId: string): Promise<InputImage | null>;
  getInputImage(suiteId: string, inputImageId: string): Promise<InputImage | null>;
  beginBaseGeneration(input: BaseGenerationAttemptInput): Promise<BaseGenerationReservation>;
  completeBaseGeneration(input: BaseGenerationSuccessInput): Promise<{ attempt: GenerationAttempt; version: BaseImageVersion }>;
  failBaseGeneration(attemptId: string, errorCode: string, errorMessage: string, completedAt: string): Promise<GenerationAttempt>;
  listBaseImageVersions(suiteId: string, inputImageId: string): Promise<BaseImageVersion[]>;
  listGenerationAttempts(suiteId: string, inputImageId: string): Promise<GenerationAttempt[]>;
  getBaseImageVersion(suiteId: string, inputImageId: string, versionId: string): Promise<BaseImageVersion | null>;
  selectBaseImageVersion(suiteId: string, inputImageId: string, versionId: string): Promise<BaseImageVersion | null>;
}

export interface PromptRepository {
  importRecords(records: import("./prompt-library.js").PromptTemplateRecord[]): Promise<import("./prompt-library.js").PromptTemplateRuntime[]>;
  publishVersion(versionId: string): Promise<import("./prompt-library.js").PromptTemplateRuntime | null>;
  listPublished(stage?: import("./prompt-library.js").PromptStage): Promise<import("./prompt-library.js").PromptTemplatePublic[]>;
  getPublishedVersion(versionId: string, expectedStage?: import("./prompt-library.js").PromptStage): Promise<import("./prompt-library.js").PromptTemplateRuntime | null>;
  listVersions(templateId: string): Promise<import("./prompt-library.js").PromptTemplateRuntime[]>;
  getVersion(versionId: string): Promise<import("./prompt-library.js").PromptTemplateRuntime | null>;
  updateDraft(versionId: string, patch: Partial<Pick<import("./prompt-library.js").PromptTemplateRuntime, "name" | "body" | "userPromptTemplate" | "inputSchema" | "outputSchema" | "applicability">>): Promise<import("./prompt-library.js").PromptTemplateRuntime | null>;
  copyVersion(versionId: string): Promise<import("./prompt-library.js").PromptTemplateRuntime | null>;
  retireVersion(versionId: string): Promise<import("./prompt-library.js").PromptTemplateRuntime | null>;
}

export interface PlatformProfile {
  code: string;
  name: string;
  marketScope: "overseas" | "domestic";
  mainImageStrategy: string;
  galleryStrategy: string;
  textStrategy: string;
  modelStrategy: string;
  sourceNote: string;
  sortOrder: number;
}

export interface PlatformRepository {
  listEnabled(): Promise<PlatformProfile[]>;
  find(value: string): Promise<PlatformProfile | null>;
}

export interface StorageObject { key: string; bytes: Buffer; contentType: string }
export interface StorageAdapter {
  put(object: StorageObject): Promise<void>;
  get(key: string): Promise<StorageObject | null>;
  previewUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface BaseImageVersion {
  id: string;
  suiteId: string;
  inputImageId: string;
  attemptId: string;
  versionNumber: number;
  objectKey: string;
  sha256: string;
  width: number;
  height: number;
  mimeType: "image/png";
  createdAt: string;
}

export type GenerationAttemptStatus = "running" | "succeeded" | "failed";

export interface GenerationAttempt {
  id: string;
  suiteId: string;
  inputImageId: string;
  baseVersionId: string;
  versionNumber: number;
  idempotencyKey: string;
  status: GenerationAttemptStatus;
  model: "gpt-image-2";
  endpoint: "/v1/images/edits";
  prompt: string;
  promptTemplateVersionId: string;
  dynamicInput: Record<string, unknown>;
  size: "1K";
  quality: "medium";
  n: 1;
  responseFormat: "b64_json";
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type BaseGenerationAttemptInput = Omit<GenerationAttempt, "versionNumber" | "status" | "errorCode" | "errorMessage" | "completedAt">;
export interface BaseGenerationReservation { attempt: GenerationAttempt; existingVersion: BaseImageVersion | null; duplicate: boolean }
export interface BaseGenerationSuccessInput {
  attemptId: string;
  objectKey: string;
  sha256: string;
  width: number;
  height: number;
  mimeType: "image/png";
  completedAt: string;
}

export interface ImageEditRequest {
  requestId?: string;
  flow?: string;
  endpoint: "/v1/images/edits";
  image: Buffer;
  imageMimeType: string;
  imageFilename: string;
  model: "gpt-image-2";
  prompt: string;
  size: "1K";
  quality: "medium";
  n: 1;
  responseFormat: "b64_json";
  images?: Array<{ bytes: Buffer; mimeType: string; filename: string; role?: string }>;
  mask?: Buffer;
  maskMimeType?: string;
  maskFilename?: string;
}

export interface ImageEditResult { bytes: Buffer; mimeType: string }
export interface ImageProvider { supportsMultipleImages?: boolean; edit(request: ImageEditRequest): Promise<ImageEditResult> }

export interface RagChunkRef { id: string; version: string }
export interface RagChunkSummary { id: string; version: string; title: string; summary: string; fieldValues: Record<string, unknown>; sourceKind: string; sourceAssetPaths: string[]; contentSha256: string }
export interface RagChunk extends RagChunkSummary { content: string; published: boolean }
export interface RagClient {
  search(query: string): Promise<RagChunkSummary[]>;
  getByIds(refs: RagChunkRef[]): Promise<RagChunk[]>;
}
export interface PlanLlmInput {
  requestId?: string; templateVersionId: string; templateBody: string; userPromptTemplate?: string; dynamicInput: Record<string, unknown>; humanInput: Record<string, unknown>;
  chunks: RagChunk[]; inputImageIds: string[]; baseVersionIds: string[]; visionImages?: PlanVisionImage[]; platformProfile?: PlatformProfile; flow?: "plan" | "category-prompt";
}
export interface CategoryPromptLlmInput extends PlanLlmInput {
  categoryCode: string;
  requestedCount: number;
  approvedFactRefs: string[];
}
export interface PlanVisionImage { id: string; sourceKind: "base" | "original"; sourceVersionId: string | null; mimeType: string; bytes: Buffer }
export interface LlmClient {
  provider: string; model: string; isFake: boolean;
  generatePlan(input: PlanLlmInput): Promise<unknown>;
  generateCategoryPrompt?(input: CategoryPromptLlmInput): Promise<unknown>;
  generateReversePrompt?(input: { template: { body: string; userPromptTemplate: string; templateVersionId: string }; referenceImageId: string; referenceImage: Buffer; baselineImage?: Buffer; mode: "main" | "detail" }): Promise<unknown>;
}
export type PlanAttemptStatus = "running" | "succeeded" | "failed";
export interface PlanItem {
  id: string;
  ordinal: number;
  imageType: "main" | "detail";
  title: string;
  purpose: string;
  prompt: string;
  categoryCode?: string;
  referenceImageIds?: string[];
  factRefs?: string[];
  allowsTextOverlay?: "platform_default" | "yes" | "no";
  textContent?: Array<{ text: string; source: string }>;
  aspectRatio?: string;
  suggestedParams?: Record<string, unknown>;
  globalStyleCard?: Record<string, unknown>;
  promptSha256?: string;
}
export interface PlanChunkSnapshot { sourceChunkId: string; sourceVersion: string; title: string; content: string; fieldValues: Record<string, unknown>; sourceKind: string; sourceAssetPaths: string[]; contentSha256: string }
export interface StructureAllocation {
  category: string;
  requirement: "required" | "optional";
  count: number;
  reason: string;
  sourceImageIds: string[];
  factRefs: string[];
  missingFacts: string[];
}
export interface MainStructureAllocation extends Omit<StructureAllocation, "category" | "requirement"> {
  category: "main";
}
export interface StructurePlanV1 {
  mainImageCount: number;
  detailImageCount: number;
  categoryAllocations: Array<Record<string, unknown>>;
  globalStyleCard: Record<string, unknown>;
  canProceed: boolean;
}
export interface StructurePlanV2 {
  status: "READY_FOR_REVIEW" | "NEEDS_HUMAN_INPUT";
  mainAllocation: MainStructureAllocation;
  detailImageCount: number;
  categoryAllocations: StructureAllocation[];
  globalStyleCard: { promptPrefix: string };
}
export type PlanStructure = StructurePlanV1 | StructurePlanV2;
export interface PlanSnapshot {
  id: string; suiteId: string; revisionNumber: number; revisionKind: "llm" | "human"; parentSnapshotId: string | null;
  templateVersionId: string; dynamicInput: Record<string, unknown>; humanInput: Record<string, unknown>; chunks: PlanChunkSnapshot[];
  inputImageIds: string[]; baseVersionIds: string[]; provider: { name: string; model: string; isFake: boolean };
  requestSummary: Record<string, unknown>; rawOutputSummary: Record<string, unknown>; schemaVersion: string; items: PlanItem[]; createdAt: string;
  phase?: "legacy_plan" | "structure_plan";
  confirmationStatus?: "draft" | "confirmed";
  confirmedAt?: string | null;
  structure?: PlanStructure;
  categoryOutputs?: Record<string, { status: "succeeded" | "failed" | "running"; requestedCount: number; items: Array<Record<string, unknown>>; errorCode?: string | null; errorMessage?: string | null }>;
}
export interface PlanAttempt {
  id: string; suiteId: string; idempotencyKey: string; status: PlanAttemptStatus; templateVersionId: string;
  dynamicInput: Record<string, unknown>; humanInput: Record<string, unknown>; selectedChunks: RagChunkRef[]; inputImageIds: string[]; baseVersionIds: string[];
  provider: { name: string; model: string; isFake: boolean }; errorCode: string | null; errorMessage: string | null;
  outputSummary: Record<string, unknown> | null; snapshotId: string | null; createdAt: string; completedAt: string | null;
}
export interface PlanRepository {
  beginAttempt(attempt: PlanAttempt): Promise<{ attempt: PlanAttempt; duplicate: boolean }>;
  failAttempt(id: string, code: string, message: string, outputSummary?: Record<string, unknown>): Promise<PlanAttempt>;
  completeAttempt(id: string, snapshot: PlanSnapshot): Promise<{ attempt: PlanAttempt; snapshot: PlanSnapshot }>;
  getAttempt(id: string): Promise<PlanAttempt | null>;
  getLatestAttempt(suiteId: string): Promise<PlanAttempt | null>;
  getSnapshot(id: string): Promise<PlanSnapshot | null>;
  getLatestSnapshot(suiteId: string): Promise<PlanSnapshot | null>;
  appendRevision(snapshot: PlanSnapshot): Promise<PlanSnapshot>;
}

export type CategoryPromptRequestStatus = "running" | "succeeded" | "failed";
export interface CategoryPromptItem {
  stableId: string;
  category: string;
  title: string;
  purpose: string;
  referenceImageIds: string[];
  factRefs: string[];
  prompt: string;
  allowsTextOverlay: "platform_default" | "yes" | "no";
  textContent: Array<{ text: string; source: string }>;
  aspectRatio: string;
  suggestedParams: Record<string, unknown>;
}
export interface CategoryPromptRequest {
  id: string;
  suiteId: string;
  planSnapshotId: string;
  categoryCode: string;
  requestedCount: number;
  status: CategoryPromptRequestStatus;
  idempotencyKey: string;
  retryOfRequestId: string | null;
  templateVersionId: string;
  dynamicInput: Record<string, unknown>;
  humanInput: Record<string, unknown>;
  approvedFactRefs: string[];
  inputImageIds: string[];
  baseVersionIds: string[];
  provider: { name: string; model: string; isFake: boolean };
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown> | null;
  items: CategoryPromptItem[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface CategoryPromptRepository {
  beginRequest(request: CategoryPromptRequest): Promise<{ request: CategoryPromptRequest; duplicate: boolean }>;
  completeRequest(id: string, items: CategoryPromptItem[], responseSummary: Record<string, unknown>): Promise<CategoryPromptRequest>;
  failRequest(id: string, errorCode: string, errorMessage: string, responseSummary?: Record<string, unknown>): Promise<CategoryPromptRequest>;
  getRequest(id: string): Promise<CategoryPromptRequest | null>;
  listRequests(planSnapshotId: string): Promise<CategoryPromptRequest[]>;
}

export type SuiteTaskStatus = "incomplete" | "pending" | "generating" | "generated" | "refining" | "failed" | "archived";
export type TaskImageType = "main" | "detail";
export type TaskBatchKind = "batch" | "single" | "retry";
export type TaskBatchStatus = "running" | "completed" | "partial" | "failed";
export type TaskSlotStatus = "pending" | "generating" | "succeeded" | "failed";

export interface SuiteTask {
  id: string; suiteId: string; planSnapshotId: string | null; planItemId: string | null; ordinal: number;
  imageType: TaskImageType; title: string; purpose: string; promptDraft: string;
  promptRevision: number; sourceInputImageId: string | null; generationParams: Record<string, unknown>;
  status: SuiteTaskStatus; archivedAt: string | null; createdAt: string; updatedAt: string;
  categoryCode?: string;
  referenceImageIds?: string[];
  factRefs?: string[];
  globalStyleCard?: Record<string, unknown>;
  promptSha256?: string;
  originKind?: "suite_plan" | "reverse_import";
  reversePlanId?: string | null;
  reverseReferenceId?: string | null;
  reversePromptVersionId?: string | null;
  reverseTaskGroupId?: string | null;
  sourceLibraryReferenceId?: string | null;
  sourceResourceVersionId?: string | null;
  sourceRevision?: number;
}
export interface TaskGenerationBatch {
  id: string; suiteId: string; kind: TaskBatchKind; requestedCount: number; taskIds: string[];
  status: TaskBatchStatus; idempotencyKey: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface TaskResultSlot {
  id: string; batchId: string; taskId: string; slotOrdinal: number; retryOfSlotId: string | null;
  status: TaskSlotStatus; selectedVersionId: string | null; createdAt: string; completedAt: string | null;
}
export interface TaskGenerationAttempt {
  id: string; slotId: string; attemptNo: number; provider: string; model: string; endpoint: "/v1/images/edits";
  requestSummary: Record<string, unknown>; promptSnapshot: Record<string, unknown>; promptSha256: string;
  contextSnapshot: Record<string, unknown>; sourceKind: "base" | "original" | "library"; sourceObjectKey: string;
  sourceInputImageId: string | null; sourceBaseVersionId: string | null;
  sourceLibraryReferenceId?: string | null; sourceResourceVersionId?: string | null; status: GenerationAttemptStatus;
  errorCode: string | null; errorMessage: string | null; externalRequestId: string | null;
  startedAt: string; finishedAt: string | null;
}
export interface TaskImageVersion {
  id: string; taskId: string; slotId: string; attemptId: string; versionNumber: number; objectKey: string;
  processObjectKeys: string[]; sha256: string; width: number; height: number; mimeType: string;
  promptSnapshot: Record<string, unknown>; contextSnapshot: Record<string, unknown>;
  isCurrent: boolean; isFinal: boolean; createdAt: string; previewUrl: string;
}
export interface SuiteTaskAggregate extends SuiteTask {
  versions: TaskImageVersion[]; attempts: TaskGenerationAttempt[]; slots: TaskResultSlot[];
}
export interface SuiteWorkbenchAggregate {
  suite: Suite; inputImages: InputImage[]; planSnapshot: PlanSnapshot | null; tasks: SuiteTaskAggregate[]; batches: TaskGenerationBatch[];
}
export interface CanvasLayoutNode { nodeId: string; x: number; y: number; width?: number; height?: number; groupKey?: string; hidden?: boolean }
export interface CanvasLayoutGroup { groupKey: string; x: number; y: number; width: number; height: number; collapsed?: boolean }
export interface CanvasLayout { id: string; suiteId: string; layoutVersion: number; viewport: { x: number; y: number; zoom: number }; nodes: CanvasLayoutNode[]; groups: CanvasLayoutGroup[]; updatedAt: string }
export interface TaskRepository {
  createTasksFromSnapshot(suiteId: string, snapshot: PlanSnapshot, inputImages: InputImage[]): Promise<{ tasks: SuiteTask[]; created: SuiteTask[] }>;
  createReverseTasks(input: { suiteId: string; reversePlanId: string; taskGroupId: string; mode: ReverseMode; idempotencyKey: string; items: Array<{ referenceId: string; ordinal: number; filename: string; promptVersionId: string; prompt: string }> }): Promise<{ tasks: SuiteTask[]; created: SuiteTask[]; duplicate: boolean }>;
  getTask(taskId: string): Promise<SuiteTask | null>;
  listTasks(suiteId: string): Promise<SuiteTask[]>;
  updateTask(taskId: string, patch: Partial<Pick<SuiteTask, "title" | "purpose" | "promptDraft" | "sourceInputImageId" | "generationParams" | "status" | "sourceLibraryReferenceId" | "sourceResourceVersionId" | "sourceRevision">>): Promise<SuiteTask | null>;
  beginBatch(input: { batch: TaskGenerationBatch; slots: TaskResultSlot[]; attempts: TaskGenerationAttempt[] }): Promise<{ batch: TaskGenerationBatch; slots: TaskResultSlot[]; attempts: TaskGenerationAttempt[]; duplicate: boolean }>;
  getBatch(batchId: string): Promise<TaskGenerationBatch | null>;
  listBatches(suiteId: string): Promise<TaskGenerationBatch[]>;
  getSlot(slotId: string): Promise<TaskResultSlot | null>;
  listSlots(suiteId: string): Promise<TaskResultSlot[]>;
  getAttempt(attemptId: string): Promise<TaskGenerationAttempt | null>;
  completeAttempt(input: { attemptId: string; slotId: string; taskId: string; objectKey: string; processObjectKeys: string[]; sha256: string; width: number; height: number; mimeType: string; completedAt: string }): Promise<{ attempt: TaskGenerationAttempt; version: TaskImageVersion }>;
  failAttempt(attemptId: string, code: string, message: string, completedAt: string): Promise<TaskGenerationAttempt>;
  selectVersion(taskId: string, versionId: string, selection: "current" | "final"): Promise<TaskImageVersion | null>;
  listTaskVersions(taskId: string): Promise<{ versions: TaskImageVersion[]; attempts: TaskGenerationAttempt[] }>;
  getLayout(suiteId: string): Promise<CanvasLayout | null>;
  saveLayout(suiteId: string, expectedVersion: number, layout: Omit<CanvasLayout, "id" | "suiteId" | "layoutVersion" | "updatedAt">): Promise<CanvasLayout>;
}

export type LibraryResourceType = "prompt_template" | "input_image" | "base_image" | "task_image_version" | "process_image" | "reverse_reference_asset";
export type LibraryAssetStatus = "draft" | "published" | "archived";
export type LibraryReferenceTargetType = "plan" | "task";
export interface LibraryResource {
  id: string;
  resourceType: LibraryResourceType;
  title: string;
  summary: string;
  mimeType: string | null;
  previewUrl: string | null;
  suiteId: string | null;
  taskId: string | null;
  imageVersionId: string | null;
  baseVersionId: string | null;
  templateVersionId: string | null;
  resourceVersionId: string;
  stage: PromptStage | null;
  source: Record<string, unknown>;
  status?: LibraryAssetStatus;
  promptSnapshot?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
export interface LibraryReference {
  id: string;
  suiteId: string;
  resourceId: string;
  resourceType: LibraryResourceType;
  targetType: LibraryReferenceTargetType;
  targetId: string;
  resourceVersionId: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
  archivedAt: string | null;
}
export interface LibraryResourceQuery {
  resourceType?: LibraryResourceType;
  stage?: PromptStage;
  suiteId?: string;
  query?: string;
  page?: number;
  pageSize?: number;
  status?: LibraryAssetStatus;
}
export interface LibraryRepository {
  listResources(query: LibraryResourceQuery): Promise<{ items: LibraryResource[]; total: number; page: number; pageSize: number }>;
  getResource(resourceId: string): Promise<LibraryResource | null>;
  getPreviewObject(resourceId: string): Promise<{ objectKey: string } | null>;
  createReference(input: { suiteId: string; resourceId: string; targetType: LibraryReferenceTargetType; targetId: string; idempotencyKey: string; createdBy?: string | null }): Promise<{ reference: LibraryReference; duplicate: boolean }>;
  listReferences(suiteId: string, targetType?: LibraryReferenceTargetType, targetId?: string): Promise<LibraryReference[]>;
  archiveReference(suiteId: string, referenceId: string): Promise<LibraryReference | null>;
  createReverseReferenceAsset(input: { suiteId?: string | null; title: string; summary?: string; objectKey: string; mimeType: string; promptSnapshot: Record<string, unknown>; visualStructure?: Record<string, unknown>; source?: Record<string, unknown> }): Promise<LibraryResource>;
  setResourceStatus(resourceId: string, status: LibraryAssetStatus): Promise<LibraryResource | null>;
}

export type ReverseMode = "main" | "detail";
export type ReversePlanStatus = "draft" | "archived";
export type ReverseAttemptStatus = "pending" | "running" | "succeeded" | "failed";
export interface ReversePromptVersion {
  id: string; referenceId: string; kind: "model" | "user"; prompt: string;
  rawOutput: unknown; templateVersionId: string; mode: ReverseMode;
  provider: { name: string; model: string; isFake: boolean }; createdAt: string;
}
export interface ReverseAttempt {
  id: string; referenceId: string; status: ReverseAttemptStatus; retryOfAttemptId: string | null;
  templateVersionId: string; mode: ReverseMode; baselineReferenceId: string | null;
  requestSummary: Record<string, unknown>; rawOutput: unknown; errorCode: string | null; errorMessage: string | null;
  promptVersionId: string | null; createdAt: string; completedAt: string | null;
}
export interface ReverseReference {
  id: string; planId: string; ordinal: number; filename: string; mimeType: string; sha256: string;
  width: number; height: number; objectKey: string; thumbnailObjectKey: string; templateVersionId: string | null;
  attempts: ReverseAttempt[]; promptVersions: ReversePromptVersion[]; effectivePromptVersionId: string | null; createdAt: string;
}
export interface ReversePlan { id: string; mode: ReverseMode; status: ReversePlanStatus; baselineReferenceId: string | null; references: ReverseReference[]; createdAt: string; updatedAt: string; }
export interface ReverseRepository {
  createPlan(idempotencyKey?: string): Promise<{ plan: ReversePlan; duplicate: boolean }>;
  getPlan(id: string): Promise<ReversePlan | null>;
  listPlans(): Promise<ReversePlan[]>;
  savePlan(plan: ReversePlan): Promise<ReversePlan>;
}

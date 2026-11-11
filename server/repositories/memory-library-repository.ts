import { randomUUID } from "node:crypto";
import type { LibraryAssetStatus, LibraryReference, LibraryRepository, LibraryResource, LibraryResourceQuery } from "../types.js";

export class MemoryLibraryRepository implements LibraryRepository {
  private readonly resources = new Map<string, LibraryResource>();
  private readonly references = new Map<string, LibraryReference>();
  private readonly idempotency = new Map<string, string>();

  addResource(resource: LibraryResource): LibraryResource {
    this.resources.set(resource.id, resource);
    return resource;
  }

  async listResources(query: LibraryResourceQuery) {
    const page = Math.max(1, query.page ?? 1); const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
    const needle = query.query?.trim().toLocaleLowerCase();
    const filtered = [...this.resources.values()].filter((resource) =>
      (!query.resourceType || resource.resourceType === query.resourceType)
      && (!query.stage || resource.stage === query.stage)
      && (!query.suiteId || resource.suiteId === query.suiteId || resource.suiteId === null)
      && (!query.status || resource.status === query.status)
      && (!needle || `${resource.title} ${resource.summary}`.toLocaleLowerCase().includes(needle)),
    ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }

  async getResource(resourceId: string) { return this.resources.get(resourceId) ?? null; }

  async getPreviewObject(resourceId: string) {
    const resource = this.resources.get(resourceId);
    const objectKey = typeof resource?.source.objectKey === "string" ? resource.source.objectKey : null;
    return objectKey ? { objectKey } : null;
  }

  async createReference(input: { suiteId: string; resourceId: string; targetType: "plan" | "task"; targetId: string; idempotencyKey: string; createdBy?: string | null }) {
    const existingId = this.idempotency.get(`${input.suiteId}:${input.idempotencyKey}`);
    if (existingId) return { reference: this.references.get(existingId)!, duplicate: true };
    const resource = this.resources.get(input.resourceId);
    if (!resource) throw new Error("LIBRARY_RESOURCE_NOT_FOUND");
    if (resource.status && resource.status !== "published") throw new Error("LIBRARY_RESOURCE_NOT_PUBLISHED");
    if (resource.resourceType === "process_image") throw new Error("LIBRARY_PROCESS_IMAGE_NOT_SELECTABLE");
    if (resource.resourceType === "prompt_template" && ((input.targetType === "plan" && resource.stage !== "plan") || (input.targetType === "task" && resource.stage !== "task_image"))) throw new Error("LIBRARY_STAGE_MISMATCH");
    const duplicate = [...this.references.values()].find((reference) => reference.suiteId === input.suiteId && reference.resourceId === input.resourceId && reference.targetType === input.targetType && reference.targetId === input.targetId && !reference.archivedAt);
    if (duplicate) { this.idempotency.set(`${input.suiteId}:${input.idempotencyKey}`, duplicate.id); return { reference: duplicate, duplicate: true }; }
    const now = new Date().toISOString();
    const reference: LibraryReference = { id: randomUUID(), suiteId: input.suiteId, resourceId: resource.id, resourceType: resource.resourceType, targetType: input.targetType, targetId: input.targetId, resourceVersionId: resource.resourceVersionId, snapshot: { ...resource, previewUrl: undefined }, createdAt: now, createdBy: input.createdBy ?? null, archivedAt: null };
    this.references.set(reference.id, reference); this.idempotency.set(`${input.suiteId}:${input.idempotencyKey}`, reference.id);
    return { reference, duplicate: false };
  }

  async listReferences(suiteId: string, targetType?: "plan" | "task", targetId?: string) {
    return [...this.references.values()].filter((reference) => reference.suiteId === suiteId && !reference.archivedAt && (!targetType || reference.targetType === targetType) && (!targetId || reference.targetId === targetId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async archiveReference(suiteId: string, referenceId: string) {
    const reference = this.references.get(referenceId);
    if (!reference || reference.suiteId !== suiteId) return null;
    const archived = { ...reference, archivedAt: new Date().toISOString() };
    this.references.set(reference.id, archived); return archived;
  }

  async createReverseReferenceAsset(input: { suiteId?: string | null; title: string; summary?: string; objectKey: string; mimeType: string; promptSnapshot: Record<string, unknown>; visualStructure?: Record<string, unknown>; source?: Record<string, unknown> }): Promise<LibraryResource> {
    const now = new Date().toISOString();
    const resource: LibraryResource = { id: `reverse:${randomUUID()}`, resourceType: "reverse_reference_asset", title: input.title, summary: input.summary ?? "", mimeType: input.mimeType, previewUrl: null, suiteId: input.suiteId ?? null, taskId: null, imageVersionId: null, baseVersionId: null, templateVersionId: typeof input.source?.templateVersionId === "string" ? input.source.templateVersionId : null, resourceVersionId: randomUUID(), stage: "task_image", source: { objectKey: input.objectKey, ...(input.source ?? {}), visualStructure: input.visualStructure ?? {} }, status: "draft", promptSnapshot: input.promptSnapshot, createdAt: now, updatedAt: now };
    this.resources.set(resource.id, resource); return resource;
  }

  async setResourceStatus(resourceId: string, status: LibraryAssetStatus) {
    const resource = this.resources.get(resourceId); if (!resource) return null;
    const next = { ...resource, status, updatedAt: new Date().toISOString() }; this.resources.set(resourceId, next); return next;
  }
}

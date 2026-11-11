import { randomUUID } from "node:crypto";
import type { BaseGenerationAttemptInput, BaseGenerationSuccessInput, BaseImageVersion, GenerationAttempt, InputImage, Suite, SuiteRepository } from "../types.js";

export class MemorySuiteRepository implements SuiteRepository {
  private suites = new Map<string, Suite>();
  private images = new Map<string, InputImage>();
  private suiteIdempotency = new Map<string, Suite>();
  private imageIdempotency = new Map<string, InputImage>();
  private attempts = new Map<string, GenerationAttempt>();
  private generationIdempotency = new Map<string, string>();
  private versions = new Map<string, BaseImageVersion>();

  async createSuite(name: string, idempotencyKey?: string) {
    if (idempotencyKey && this.suiteIdempotency.has(idempotencyKey)) return this.suiteIdempotency.get(idempotencyKey)!;
    const now = new Date().toISOString();
    const suite = { id: randomUUID(), name, status: "draft" as const, createdAt: now, updatedAt: now };
    this.suites.set(suite.id, suite);
    if (idempotencyKey) this.suiteIdempotency.set(idempotencyKey, suite);
    return suite;
  }
  async listSuites() { return [...this.suites.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async getSuite(id: string) { return this.suites.get(id) ?? null; }
  async getInputImages(suiteId: string) { return [...this.images.values()].filter((image) => image.suiteId === suiteId).sort((a, b) => a.ordinal - b.ordinal); }
  async getInputImage(suiteId: string, inputImageId: string) { const image = this.images.get(inputImageId); return image?.suiteId === suiteId ? image : null; }
  async hasInputImageHash(suiteId: string, sha256: string) { return [...this.images.values()].some((image) => image.suiteId === suiteId && image.sha256 === sha256); }
  async createInputImage(input: Omit<InputImage, "originalPreviewUrl" | "thumbnailPreviewUrl">, idempotencyKey?: string) {
    if (idempotencyKey && this.imageIdempotency.has(idempotencyKey)) return this.imageIdempotency.get(idempotencyKey)!;
    if ([...this.images.values()].some((image) => image.suiteId === input.suiteId && image.ordinal === input.ordinal)) throw new Error("DUPLICATE_ORDINAL");
    if ([...this.images.values()].some((image) => image.suiteId === input.suiteId && image.sha256 === input.sha256)) throw new Error("DUPLICATE_IMAGE");
    const result = { ...input, originalPreviewUrl: `/api/suites/${input.suiteId}/input-images/${input.id}/preview/original`, thumbnailPreviewUrl: `/api/suites/${input.suiteId}/input-images/${input.id}/preview/thumbnail` };
    this.images.set(result.id, result);
    if (idempotencyKey) this.imageIdempotency.set(idempotencyKey, result);
    const suite = this.suites.get(input.suiteId);
    if (suite) this.suites.set(suite.id, { ...suite, status: "in_progress", updatedAt: input.createdAt });
    return result;
  }

  async removeInputImage(suiteId: string, inputImageId: string) {
    const image = await this.getInputImage(suiteId, inputImageId);
    if (!image) return null;
    if ([...this.attempts.values()].some((attempt) => attempt.inputImageId === inputImageId)) throw new Error("INPUT_IMAGE_HAS_HISTORY");
    this.images.delete(inputImageId);
    return image;
  }

  async beginBaseGeneration(input: BaseGenerationAttemptInput) {
    const idempotencyScope = `${input.inputImageId}:${input.idempotencyKey}`;
    const existingId = this.generationIdempotency.get(idempotencyScope);
    if (existingId) {
      const attempt = this.attempts.get(existingId)!;
      return { attempt, existingVersion: this.versions.get(attempt.baseVersionId) ?? null, duplicate: true };
    }
    const versionNumber = Math.max(0, ...[...this.versions.values()].filter((version) => version.inputImageId === input.inputImageId).map((version) => version.versionNumber)) + 1;
    const attempt: GenerationAttempt = { ...input, versionNumber, status: "running", errorCode: null, errorMessage: null, completedAt: null };
    this.attempts.set(attempt.id, attempt);
    this.generationIdempotency.set(idempotencyScope, attempt.id);
    return { attempt, existingVersion: null, duplicate: false };
  }

  async completeBaseGeneration(input: BaseGenerationSuccessInput) {
    const current = this.attempts.get(input.attemptId);
    if (!current) throw new Error("INVALID_GENERATION_ATTEMPT");
    const attempt: GenerationAttempt = { ...current, status: "succeeded", completedAt: input.completedAt };
    const version: BaseImageVersion = {
      id: current.baseVersionId,
      suiteId: current.suiteId,
      inputImageId: current.inputImageId,
      attemptId: current.id,
      versionNumber: current.versionNumber,
      objectKey: input.objectKey,
      sha256: input.sha256,
      width: input.width,
      height: input.height,
      mimeType: input.mimeType,
      createdAt: input.completedAt,
    };
    this.attempts.set(attempt.id, attempt);
    this.versions.set(version.id, version);
    const image = this.images.get(current.inputImageId);
    if (image) this.images.set(image.id, { ...image, currentBaseVersionId: version.id });
    return { attempt, version };
  }

  async failBaseGeneration(attemptId: string, errorCode: string, errorMessage: string, completedAt: string) {
    const current = this.attempts.get(attemptId);
    if (!current) throw new Error("INVALID_GENERATION_ATTEMPT");
    const attempt: GenerationAttempt = { ...current, status: "failed", errorCode, errorMessage, completedAt };
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async listBaseImageVersions(suiteId: string, inputImageId: string) {
    return [...this.versions.values()].filter((version) => version.suiteId === suiteId && version.inputImageId === inputImageId).sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async listGenerationAttempts(suiteId: string, inputImageId: string) {
    return [...this.attempts.values()].filter((attempt) => attempt.suiteId === suiteId && attempt.inputImageId === inputImageId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBaseImageVersion(suiteId: string, inputImageId: string, versionId: string) {
    const version = this.versions.get(versionId);
    return version?.suiteId === suiteId && version.inputImageId === inputImageId ? version : null;
  }

  async selectBaseImageVersion(suiteId: string, inputImageId: string, versionId: string) {
    const version = await this.getBaseImageVersion(suiteId, inputImageId, versionId);
    const image = await this.getInputImage(suiteId, inputImageId);
    if (!version || !image) return null;
    this.images.set(image.id, { ...image, currentBaseVersionId: version.id });
    return version;
  }
}

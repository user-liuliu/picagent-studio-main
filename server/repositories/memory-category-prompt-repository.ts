import type { CategoryPromptItem, CategoryPromptRequest, CategoryPromptRepository } from "../types.js";

export class MemoryCategoryPromptRepository implements CategoryPromptRepository {
  private readonly requests = new Map<string, CategoryPromptRequest>();
  private readonly idempotency = new Map<string, string>();

  async beginRequest(request: CategoryPromptRequest) {
    if (!request.retryOfRequestId) {
      const active = [...this.requests.values()]
        .filter((item) => item.suiteId === request.suiteId && item.planSnapshotId === request.planSnapshotId && item.categoryCode === request.categoryCode && (item.status === "running" || item.status === "succeeded"))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (active) return { request: active, duplicate: true };
    }
    const existingId = this.idempotency.get(`${request.suiteId}:${request.planSnapshotId}:${request.categoryCode}:${request.idempotencyKey}`);
    if (existingId) return { request: this.requests.get(existingId)!, duplicate: true };
    this.requests.set(request.id, request);
    this.idempotency.set(`${request.suiteId}:${request.planSnapshotId}:${request.categoryCode}:${request.idempotencyKey}`, request.id);
    return { request, duplicate: false };
  }

  async completeRequest(id: string, items: CategoryPromptItem[], responseSummary: Record<string, unknown>) {
    const current = this.requests.get(id);
    if (!current) throw new Error("INVALID_CATEGORY_PROMPT_REQUEST");
    const request = { ...current, status: "succeeded" as const, items, responseSummary, completedAt: new Date().toISOString() };
    this.requests.set(id, request);
    return request;
  }

  async failRequest(id: string, errorCode: string, errorMessage: string, responseSummary: Record<string, unknown> = {}) {
    const current = this.requests.get(id);
    if (!current) throw new Error("INVALID_CATEGORY_PROMPT_REQUEST");
    const request = { ...current, status: "failed" as const, errorCode, errorMessage, responseSummary, completedAt: new Date().toISOString() };
    this.requests.set(id, request);
    return request;
  }

  async getRequest(id: string) { return this.requests.get(id) ?? null; }

  async listRequests(planSnapshotId: string) {
    return [...this.requests.values()]
      .filter((request) => request.planSnapshotId === planSnapshotId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

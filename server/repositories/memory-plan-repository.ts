import type { PlanAttempt, PlanRepository, PlanSnapshot } from "../types.js";

export class MemoryPlanRepository implements PlanRepository {
  private attempts = new Map<string, PlanAttempt>();
  private idempotency = new Map<string, string>();
  private snapshots = new Map<string, PlanSnapshot>();

  async beginAttempt(attempt: PlanAttempt) {
    const scope = `${attempt.suiteId}:${attempt.idempotencyKey}`;
    const id = this.idempotency.get(scope);
    if (id) return { attempt: this.attempts.get(id)!, duplicate: true };
    this.attempts.set(attempt.id, attempt); this.idempotency.set(scope, attempt.id);
    return { attempt, duplicate: false };
  }
  async failAttempt(id: string, errorCode: string, errorMessage: string, outputSummary: Record<string, unknown> = {}) {
    const current = this.attempts.get(id); if (!current) throw new Error("INVALID_PLAN_ATTEMPT");
    const attempt = { ...current, status: "failed" as const, errorCode, errorMessage, outputSummary, completedAt: new Date().toISOString() };
    this.attempts.set(id, attempt); return attempt;
  }
  async completeAttempt(id: string, snapshot: PlanSnapshot) {
    const current = this.attempts.get(id); if (!current) throw new Error("INVALID_PLAN_ATTEMPT");
    this.snapshots.set(snapshot.id, snapshot);
    const attempt = { ...current, status: "succeeded" as const, snapshotId: snapshot.id, completedAt: new Date().toISOString() };
    this.attempts.set(id, attempt); return { attempt, snapshot };
  }
  async getAttempt(id: string) { return this.attempts.get(id) ?? null; }
  async getLatestAttempt(suiteId: string) { return [...this.attempts.values()].filter((item) => item.suiteId === suiteId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0] ?? null; }
  async getSnapshot(id: string) { return this.snapshots.get(id) ?? null; }
  async getLatestSnapshot(suiteId: string) { return [...this.snapshots.values()].filter((item) => item.suiteId === suiteId).sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null; }
  async appendRevision(snapshot: PlanSnapshot) { this.snapshots.set(snapshot.id, snapshot); return snapshot; }
}

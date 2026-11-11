import { randomUUID } from "node:crypto";
import type { ReversePlan, ReverseRepository } from "../types.js";

export class MemoryReverseRepository implements ReverseRepository {
  private plans = new Map<string, ReversePlan>();
  private idempotency = new Map<string, string>();
  async createPlan(idempotencyKey?: string) {
    if (idempotencyKey) { const existing = this.idempotency.get(idempotencyKey); if (existing) return { plan: this.plans.get(existing)!, duplicate: true }; }
    const now = new Date().toISOString();
    const plan: ReversePlan = { id: randomUUID(), mode: "main", status: "draft", baselineReferenceId: null, references: [], createdAt: now, updatedAt: now };
    this.plans.set(plan.id, plan); if (idempotencyKey) this.idempotency.set(idempotencyKey, plan.id); return { plan, duplicate: false };
  }
  async getPlan(id: string) { return this.plans.get(id) ?? null; }
  async listPlans() { return [...this.plans.values()].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async savePlan(plan: ReversePlan) { this.plans.set(plan.id, plan); return plan; }
}

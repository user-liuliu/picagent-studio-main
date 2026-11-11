import type { Pool } from "pg";
import type { CategoryPromptItem, CategoryPromptRequest, CategoryPromptRepository } from "../types.js";

const columns = `id, suite_id AS "suiteId", plan_snapshot_id AS "planSnapshotId", category_code AS "categoryCode", requested_count AS "requestedCount", status, idempotency_key AS "idempotencyKey", retry_of_request_id AS "retryOfRequestId", template_version_id AS "templateVersionId", dynamic_input_json AS "dynamicInput", human_input_json AS "humanInput", approved_fact_refs_json AS "approvedFactRefs", input_image_ids_json AS "inputImageIds", base_version_ids_json AS "baseVersionIds", jsonb_build_object('name', provider, 'model', model, 'isFake', is_fake) AS provider, request_summary_json AS "requestSummary", response_summary_json AS "responseSummary", output_items_json AS items, error_code AS "errorCode", error_message AS "errorMessage", created_at AS "createdAt", completed_at AS "completedAt"`;

export class PostgresCategoryPromptRepository implements CategoryPromptRepository {
  constructor(private readonly pool: Pool) {}

  async beginRequest(request: CategoryPromptRequest) {
    if (!request.retryOfRequestId) {
      const active = await this.pool.query<CategoryPromptRequest>(
        `SELECT ${columns} FROM suite_workbench.plan_category_requests WHERE suite_id=$1 AND plan_snapshot_id=$2 AND category_code=$3 AND status IN ('running','succeeded') ORDER BY created_at DESC LIMIT 1`,
        [request.suiteId, request.planSnapshotId, request.categoryCode],
      );
      if (active.rows[0]) return { request: active.rows[0], duplicate: true };
    }
    const existing = await this.pool.query<CategoryPromptRequest>(
      `SELECT ${columns} FROM suite_workbench.plan_category_requests WHERE suite_id=$1 AND plan_snapshot_id=$2 AND category_code=$3 AND idempotency_key=$4`,
      [request.suiteId, request.planSnapshotId, request.categoryCode, request.idempotencyKey],
    );
    if (existing.rows[0]) return { request: existing.rows[0], duplicate: true };
    try {
      const result = await this.pool.query<CategoryPromptRequest>(
        `INSERT INTO suite_workbench.plan_category_requests (id,suite_id,plan_snapshot_id,category_code,requested_count,status,idempotency_key,retry_of_request_id,template_version_id,dynamic_input_json,human_input_json,approved_fact_refs_json,input_image_ids_json,base_version_ids_json,provider,model,is_fake,request_summary_json,output_items_json,created_at)
         VALUES ($1,$2,$3,$4,$5,'running',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'[]'::jsonb,$18)
         RETURNING ${columns}`,
        [request.id, request.suiteId, request.planSnapshotId, request.categoryCode, request.requestedCount, request.idempotencyKey, request.retryOfRequestId, request.templateVersionId, JSON.stringify(request.dynamicInput), JSON.stringify(request.humanInput), JSON.stringify(request.approvedFactRefs), JSON.stringify(request.inputImageIds), JSON.stringify(request.baseVersionIds), request.provider.name, request.provider.model, request.provider.isFake, JSON.stringify(request.requestSummary), request.createdAt],
      );
      return { request: result.rows[0], duplicate: false };
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      const active = await this.pool.query<CategoryPromptRequest>(
        `SELECT ${columns} FROM suite_workbench.plan_category_requests WHERE suite_id=$1 AND plan_snapshot_id=$2 AND category_code=$3 AND status IN ('running','succeeded') ORDER BY created_at DESC LIMIT 1`,
        [request.suiteId, request.planSnapshotId, request.categoryCode],
      );
      if (active.rows[0]) return { request: active.rows[0], duplicate: true };
      throw error;
    }
  }

  async completeRequest(id: string, items: CategoryPromptItem[], responseSummary: Record<string, unknown>) {
    const result = await this.pool.query<CategoryPromptRequest>(
      `UPDATE suite_workbench.plan_category_requests SET status='succeeded',output_items_json=$2,response_summary_json=$3,completed_at=now() WHERE id=$1 AND status='running' RETURNING ${columns}`,
      [id, JSON.stringify(items), JSON.stringify(responseSummary)],
    );
    if (!result.rows[0]) throw new Error("INVALID_CATEGORY_PROMPT_REQUEST");
    return result.rows[0];
  }

  async failRequest(id: string, errorCode: string, errorMessage: string, responseSummary: Record<string, unknown> = {}) {
    const result = await this.pool.query<CategoryPromptRequest>(
      `UPDATE suite_workbench.plan_category_requests SET status='failed',error_code=$2,error_message=$3,response_summary_json=$4,completed_at=now() WHERE id=$1 AND status='running' RETURNING ${columns}`,
      [id, errorCode, errorMessage, JSON.stringify(responseSummary)],
    );
    if (!result.rows[0]) throw new Error("INVALID_CATEGORY_PROMPT_REQUEST");
    return result.rows[0];
  }

  async getRequest(id: string) {
    const result = await this.pool.query<CategoryPromptRequest>(`SELECT ${columns} FROM suite_workbench.plan_category_requests WHERE id=$1`, [id]);
    return result.rows[0] ?? null;
  }

  async listRequests(planSnapshotId: string) {
    const result = await this.pool.query<CategoryPromptRequest>(`SELECT ${columns} FROM suite_workbench.plan_category_requests WHERE plan_snapshot_id=$1 ORDER BY created_at`, [planSnapshotId]);
    return result.rows;
  }
}

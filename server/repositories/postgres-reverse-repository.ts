import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ReverseAttempt, ReversePlan, ReversePromptVersion, ReverseReference, ReverseRepository } from "../types.js";

const iso = (value: string | Date): string => value instanceof Date ? value.toISOString() : value;

export class PostgresReverseRepository implements ReverseRepository {
  constructor(private readonly pool: Pool) {}

  async createPlan(idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await this.pool.query<{ id: string }>("SELECT id FROM suite_workbench.reverse_plans WHERE idempotency_key=$1", [idempotencyKey]);
      if (existing.rows[0]) return { plan: (await this.getPlan(existing.rows[0].id))!, duplicate: true };
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      await this.pool.query("INSERT INTO suite_workbench.reverse_plans (id,mode,status,idempotency_key,created_at,updated_at) VALUES ($1,'main','draft',$2,$3,$3)", [id, idempotencyKey ?? null, now]);
      return { plan: (await this.getPlan(id))!, duplicate: false };
    } catch (error) {
      if (!idempotencyKey || (error as { code?: string }).code !== "23505") throw error;
      const existing = await this.pool.query<{ id: string }>("SELECT id FROM suite_workbench.reverse_plans WHERE idempotency_key=$1", [idempotencyKey]);
      if (!existing.rows[0]) throw error;
      return { plan: (await this.getPlan(existing.rows[0].id))!, duplicate: true };
    }
  }

  async getPlan(id: string) {
    const result = await this.pool.query<any>(`SELECT id,mode,status,baseline_reference_id AS "baselineReferenceId",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM suite_workbench.reverse_plans WHERE id=$1`, [id]);
    return result.rows[0] ? this.hydratePlan(result.rows[0]) : null;
  }

  async listPlans() {
    const result = await this.pool.query<any>(`SELECT id,mode,status,baseline_reference_id AS "baselineReferenceId",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM suite_workbench.reverse_plans ORDER BY updated_at DESC,id`);
    return Promise.all(result.rows.map((row: any) => this.hydratePlan(row)));
  }

  async savePlan(plan: ReversePlan) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await client.query("UPDATE suite_workbench.reverse_plans SET mode=$2,status=$3,baseline_reference_id=NULL,updated_at=$4 WHERE id=$1", [plan.id, plan.mode, plan.status, plan.updatedAt]);
      if (!saved.rowCount) throw new Error("INVALID_REVERSE_PLAN");

      const activeIds = plan.references.map((reference) => reference.id);
      await client.query(`UPDATE suite_workbench.reverse_references SET removed_at=COALESCE(removed_at,$2)
        WHERE plan_id=$1 AND removed_at IS NULL AND NOT (id=ANY($3::uuid[]))`, [plan.id, plan.updatedAt, activeIds]);
      for (const reference of plan.references) await this.saveReference(client, reference);

      if (plan.baselineReferenceId && !activeIds.includes(plan.baselineReferenceId)) throw new Error("INVALID_REVERSE_BASELINE_REFERENCE");
      await client.query("UPDATE suite_workbench.reverse_plans SET baseline_reference_id=$2 WHERE id=$1", [plan.id, plan.baselineReferenceId]);
      await client.query("COMMIT");
      return (await this.getPlan(plan.id))!;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveReference(client: PoolClient, reference: ReverseReference) {
    await client.query(`INSERT INTO suite_workbench.reverse_references
      (id,plan_id,ordinal,filename,mime_type,sha256,width,height,object_key,thumbnail_object_key,template_version_id,effective_prompt_version_id,removed_at,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,$12)
      ON CONFLICT (id) DO UPDATE SET ordinal=EXCLUDED.ordinal,filename=EXCLUDED.filename,mime_type=EXCLUDED.mime_type,sha256=EXCLUDED.sha256,
        width=EXCLUDED.width,height=EXCLUDED.height,object_key=EXCLUDED.object_key,thumbnail_object_key=EXCLUDED.thumbnail_object_key,
        template_version_id=EXCLUDED.template_version_id,effective_prompt_version_id=NULL,removed_at=NULL`,
      [reference.id, reference.planId, reference.ordinal, reference.filename, reference.mimeType, reference.sha256, reference.width, reference.height, reference.objectKey, reference.thumbnailObjectKey, reference.templateVersionId, reference.createdAt]);

    for (const version of reference.promptVersions) {
      await client.query(`INSERT INTO suite_workbench.reverse_prompt_versions
        (id,reference_id,kind,prompt,raw_output_json,template_version_id,mode,provider_json,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [version.id, version.referenceId, version.kind, version.prompt, version.rawOutput == null ? null : JSON.stringify(version.rawOutput), version.templateVersionId, version.mode, JSON.stringify(version.provider), version.createdAt]);
    }
    for (const attempt of reference.attempts) {
      await client.query(`INSERT INTO suite_workbench.reverse_attempts
        (id,reference_id,status,retry_of_attempt_id,template_version_id,mode,baseline_reference_id,request_summary_json,raw_output_json,error_code,error_message,prompt_version_id,created_at,completed_at)
        VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12)
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,request_summary_json=EXCLUDED.request_summary_json,raw_output_json=EXCLUDED.raw_output_json,
          error_code=EXCLUDED.error_code,error_message=EXCLUDED.error_message,completed_at=EXCLUDED.completed_at`,
        [attempt.id, attempt.referenceId, attempt.status, attempt.templateVersionId, attempt.mode, attempt.baselineReferenceId, JSON.stringify(attempt.requestSummary), attempt.rawOutput == null ? null : JSON.stringify(attempt.rawOutput), attempt.errorCode, attempt.errorMessage, attempt.createdAt, attempt.completedAt]);
    }
    for (const attempt of reference.attempts) {
      await client.query("UPDATE suite_workbench.reverse_attempts SET retry_of_attempt_id=$2,prompt_version_id=$3 WHERE id=$1", [attempt.id, attempt.retryOfAttemptId, attempt.promptVersionId]);
    }
    await client.query("UPDATE suite_workbench.reverse_references SET effective_prompt_version_id=$2 WHERE id=$1", [reference.id, reference.effectivePromptVersionId]);
  }

  private async hydratePlan(row: any): Promise<ReversePlan> {
    const references = await this.pool.query<any>(`SELECT id,plan_id AS "planId",ordinal,filename,mime_type AS "mimeType",sha256,width,height,
      object_key AS "objectKey",thumbnail_object_key AS "thumbnailObjectKey",template_version_id AS "templateVersionId",
      effective_prompt_version_id AS "effectivePromptVersionId",created_at AS "createdAt"
      FROM suite_workbench.reverse_references WHERE plan_id=$1 AND removed_at IS NULL ORDER BY ordinal,id`, [row.id]);
    if (!references.rows.length) return this.mapPlan(row, []);
    const ids = references.rows.map((reference) => reference.id);
    const [attempts, versions] = await Promise.all([
      this.pool.query<any>(`SELECT id,reference_id AS "referenceId",status,retry_of_attempt_id AS "retryOfAttemptId",template_version_id AS "templateVersionId",mode,
        baseline_reference_id AS "baselineReferenceId",request_summary_json AS "requestSummary",raw_output_json AS "rawOutput",error_code AS "errorCode",
        error_message AS "errorMessage",prompt_version_id AS "promptVersionId",created_at AS "createdAt",completed_at AS "completedAt"
        FROM suite_workbench.reverse_attempts WHERE reference_id=ANY($1::uuid[]) ORDER BY created_at,id`, [ids]),
      this.pool.query<any>(`SELECT id,reference_id AS "referenceId",kind,prompt,raw_output_json AS "rawOutput",template_version_id AS "templateVersionId",mode,
        provider_json AS provider,created_at AS "createdAt" FROM suite_workbench.reverse_prompt_versions WHERE reference_id=ANY($1::uuid[]) ORDER BY created_at,id`, [ids]),
    ]);
    return this.mapPlan(row, references.rows.map((reference) => ({
      ...reference,
      createdAt: iso(reference.createdAt),
      attempts: attempts.rows.filter((attempt) => attempt.referenceId === reference.id).map(this.mapAttempt),
      promptVersions: versions.rows.filter((version) => version.referenceId === reference.id).map(this.mapPromptVersion),
    })));
  }

  private mapPlan(row: any, references: ReverseReference[]): ReversePlan {
    return { id: row.id, mode: row.mode, status: row.status, baselineReferenceId: row.baselineReferenceId, references, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
  }

  private mapAttempt = (row: any): ReverseAttempt => ({ ...row, createdAt: iso(row.createdAt), completedAt: row.completedAt ? iso(row.completedAt) : null });
  private mapPromptVersion = (row: any): ReversePromptVersion => ({ ...row, createdAt: iso(row.createdAt) });
}

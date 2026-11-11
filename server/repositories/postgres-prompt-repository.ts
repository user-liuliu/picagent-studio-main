import type { Pool, PoolClient } from "pg";
import { validatePromptTemplateContract, type PromptStage, type PromptTemplatePublic, type PromptTemplateRecord, type PromptTemplateRuntime } from "../prompt-library.js";

const runtimeColumns = `t.id AS "templateId", v.id AS "templateVersionId", v.version_no AS "versionNo",
  t.code, v.name, v.kind, v.stage, v.execution_target AS "executionTarget", v.input_schema AS "inputSchema",
  v.output_schema AS "outputSchema", v.applicability, v.body, v.user_prompt_template AS "userPromptTemplate", v.status, v.source_file AS "sourceFile",
  v.source_heading AS "sourceHeading", v.source_sha256 AS "sourceSha256"`;
const publicColumns = `t.id AS "templateId", v.id AS "templateVersionId", v.version_no AS "versionNo",
  t.code, v.name, v.kind, v.stage, v.execution_target AS "executionTarget", v.input_schema AS "inputSchema", v.applicability`;

export class PostgresPromptRepository {
  constructor(private readonly pool: Pool) {}

  async pruneExcept(codes: string[]): Promise<{ deleted: number; disabled: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string; code: string }>("SELECT id, code FROM prompt_library.prompt_templates");
      let deleted = 0;
      let disabled = 0;
      const keep = new Set(codes);
      for (const template of existing.rows.filter((row) => !keep.has(row.code))) {
        const references = await client.query<{ exists: boolean }>(`SELECT EXISTS (
          SELECT 1 FROM prompt_library.prompt_template_versions v
          WHERE v.template_id = $1 AND (
            EXISTS (SELECT 1 FROM suite_workbench.generation_attempts g WHERE g.prompt_template_version_id = v.id)
            OR EXISTS (SELECT 1 FROM suite_workbench.plan_generation_attempts p WHERE p.template_version_id = v.id)
            OR EXISTS (SELECT 1 FROM suite_workbench.plan_snapshots s WHERE s.template_version_id = v.id)
          )
        )`, [template.id]);
        if (references.rows[0]?.exists) {
          await client.query("UPDATE prompt_library.prompt_templates SET lifecycle_status = 'disabled', published_version_id = NULL WHERE id = $1", [template.id]);
          await client.query("UPDATE prompt_library.prompt_template_versions SET status = 'retired' WHERE template_id = $1 AND status = 'published'", [template.id]);
          disabled += 1;
          continue;
        }
        await client.query("UPDATE prompt_library.prompt_templates SET published_version_id = NULL WHERE id = $1", [template.id]);
        await client.query("DELETE FROM prompt_library.prompt_template_versions WHERE template_id = $1", [template.id]);
        await client.query("DELETE FROM prompt_library.prompt_templates WHERE id = $1", [template.id]);
        deleted += 1;
      }
      await client.query("COMMIT");
      return { deleted, disabled };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async importRecords(records: PromptTemplateRecord[]): Promise<PromptTemplateRuntime[]> {
    for (const record of records) validatePromptTemplateContract(record);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const imported: PromptTemplateRuntime[] = [];
      for (const record of records) imported.push(await this.importRecord(client, record));
      if (records[0]) {
        await client.query(`INSERT INTO prompt_library.prompt_imports (source_file, source_sha256, imported_count)
          VALUES ($1,$2,$3) ON CONFLICT (source_file, source_sha256) DO NOTHING`, [records[0].sourceFile, records[0].sourceSha256, records.length]);
      }
      await client.query("COMMIT");
      return imported;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async importRecord(client: PoolClient, record: PromptTemplateRecord): Promise<PromptTemplateRuntime> {
    const templateResult = await client.query<{ id: string }>(`INSERT INTO prompt_library.prompt_templates
      (id, code, name, kind, stage, execution_target) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
    [record.templateId, record.code, record.name, record.kind, record.stage, record.executionTarget]);
    const templateId = templateResult.rows[0].id;
    await client.query("SELECT id FROM prompt_library.prompt_templates WHERE id = $1 FOR UPDATE", [templateId]);
    const existing = await client.query<PromptTemplateRuntime>(`SELECT ${runtimeColumns}
      FROM prompt_library.prompt_template_versions v JOIN prompt_library.prompt_templates t ON t.id = v.template_id
      WHERE v.template_id = $1 AND v.source_sha256 = $2 AND v.source_heading = $3`, [templateId, record.sourceSha256, record.sourceHeading]);
    if (existing.rows[0]) {
      if (existing.rows[0].status === "draft") {
        const normalized = await client.query<PromptTemplateRuntime>(`UPDATE prompt_library.prompt_template_versions v SET
          name=$2, kind=$3, stage=$4, execution_target=$5, input_schema=$6, output_schema=$7, applicability=$8, body=$9, user_prompt_template=$10, source_file=$11
          FROM prompt_library.prompt_templates t WHERE v.id=$1 AND v.status='draft' AND t.id=v.template_id
          RETURNING t.id AS "templateId", v.id AS "templateVersionId", v.version_no AS "versionNo", t.code,
            v.name, v.kind, v.stage, v.execution_target AS "executionTarget", v.input_schema AS "inputSchema",
            v.output_schema AS "outputSchema", v.applicability, v.body, v.user_prompt_template AS "userPromptTemplate", v.status, v.source_file AS "sourceFile",
            v.source_heading AS "sourceHeading", v.source_sha256 AS "sourceSha256"`,
        [existing.rows[0].templateVersionId, record.name, record.kind, record.stage, record.executionTarget,
          JSON.stringify(record.inputSchema), JSON.stringify(record.outputSchema), JSON.stringify(record.applicability), record.body, record.userPromptTemplate ?? "", record.sourceFile]);
        if (normalized.rows[0]) return normalized.rows[0];
        const current = await client.query<PromptTemplateRuntime>(`SELECT ${runtimeColumns}
          FROM prompt_library.prompt_template_versions v JOIN prompt_library.prompt_templates t ON t.id = v.template_id
          WHERE v.id = $1`, [existing.rows[0].templateVersionId]);
        return current.rows[0];
      }
      return existing.rows[0];
    }
    const next = await client.query<{ version_no: number }>("SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no FROM prompt_library.prompt_template_versions WHERE template_id = $1", [templateId]);
    const inserted = await client.query<PromptTemplateRuntime>(`INSERT INTO prompt_library.prompt_template_versions
      (id, template_id, version_no, name, kind, stage, execution_target, input_schema, output_schema, applicability, body, user_prompt_template, status, source_file, source_heading, source_sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14,$15)
      RETURNING $2::uuid AS "templateId", id AS "templateVersionId", version_no AS "versionNo", $16::text AS code,
        name, kind, stage, execution_target AS "executionTarget", input_schema AS "inputSchema", output_schema AS "outputSchema",
        applicability, body, user_prompt_template AS "userPromptTemplate", status, source_file AS "sourceFile", source_heading AS "sourceHeading", source_sha256 AS "sourceSha256"`,
    [record.templateVersionId, templateId, next.rows[0].version_no, record.name, record.kind, record.stage, record.executionTarget,
      JSON.stringify(record.inputSchema), JSON.stringify(record.outputSchema), JSON.stringify(record.applicability), record.body, record.userPromptTemplate ?? "",
      record.sourceFile, record.sourceHeading, record.sourceSha256, record.code]);
    return inserted.rows[0];
  }

  async publishVersion(versionId: string): Promise<PromptTemplateRuntime | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{ template_id: string }>("SELECT template_id FROM prompt_library.prompt_template_versions WHERE id = $1 FOR UPDATE", [versionId]);
      if (!found.rows[0]) { await client.query("ROLLBACK"); return null; }
      const candidate = await client.query<PromptTemplateRuntime>(`SELECT ${runtimeColumns} FROM prompt_library.prompt_template_versions v JOIN prompt_library.prompt_templates t ON t.id = v.template_id WHERE v.id = $1`, [versionId]);
      if (!candidate.rows[0]) { await client.query("ROLLBACK"); return null; }
      validatePromptTemplateContract(candidate.rows[0]);
      await client.query("UPDATE prompt_library.prompt_template_versions SET status = 'retired' WHERE template_id = $1 AND status = 'published' AND id <> $2", [found.rows[0].template_id, versionId]);
      await client.query("UPDATE prompt_library.prompt_template_versions SET status = 'published', published_at = COALESCE(published_at, now()) WHERE id = $1", [versionId]);
      await client.query("UPDATE prompt_library.prompt_templates SET published_version_id = $2 WHERE id = $1", [found.rows[0].template_id, versionId]);
      const result = await client.query<PromptTemplateRuntime>(`SELECT ${runtimeColumns} FROM prompt_library.prompt_template_versions v JOIN prompt_library.prompt_templates t ON t.id = v.template_id WHERE v.id = $1`, [versionId]);
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listPublished(stage?: PromptStage): Promise<PromptTemplatePublic[]> {
    const result = await this.pool.query<PromptTemplatePublic>(`SELECT ${publicColumns}
      FROM prompt_library.prompt_templates t JOIN prompt_library.prompt_template_versions v ON v.id = t.published_version_id
      WHERE t.lifecycle_status = 'active' AND v.status = 'published' AND ($1::text IS NULL OR v.stage = $1)
      ORDER BY v.name`, [stage ?? null]);
    return result.rows;
  }

  async getPublishedVersion(versionId: string, expectedStage?: PromptStage): Promise<PromptTemplateRuntime | null> {
    const result = await this.pool.query<PromptTemplateRuntime>(`SELECT ${runtimeColumns}
      FROM prompt_library.prompt_templates t JOIN prompt_library.prompt_template_versions v ON v.id = t.published_version_id
      WHERE v.id = $1 AND v.status = 'published' AND t.lifecycle_status = 'active' AND ($2::text IS NULL OR v.stage = $2)`, [versionId, expectedStage ?? null]);
    return result.rows[0] ?? null;
  }

  async listVersions(templateId: string): Promise<PromptTemplateRuntime[]> {
    const result = await this.pool.query<PromptTemplateRuntime>(`SELECT ${runtimeColumns}
      FROM prompt_library.prompt_template_versions v JOIN prompt_library.prompt_templates t ON t.id = v.template_id
      WHERE t.id = $1 ORDER BY v.version_no`, [templateId]);
    return result.rows;
  }

  async getVersion(versionId: string): Promise<PromptTemplateRuntime | null> {
    const result = await this.pool.query<PromptTemplateRuntime>(`SELECT ${runtimeColumns}
      FROM prompt_library.prompt_template_versions v JOIN prompt_library.prompt_templates t ON t.id = v.template_id
      WHERE v.id = $1`, [versionId]);
    return result.rows[0] ?? null;
  }

  async updateDraft(versionId: string, patch: Partial<Pick<PromptTemplateRuntime, "name" | "body" | "userPromptTemplate" | "inputSchema" | "outputSchema" | "applicability">>): Promise<PromptTemplateRuntime | null> {
    const current = await this.getVersion(versionId);
    if (!current || current.status !== "draft") return null;
    const result = await this.pool.query<PromptTemplateRuntime>(`UPDATE prompt_library.prompt_template_versions SET
      name=COALESCE($2,name), body=COALESCE($3,body), user_prompt_template=COALESCE($4,user_prompt_template),
      input_schema=COALESCE($5,input_schema), output_schema=COALESCE($6,output_schema), applicability=COALESCE($7,applicability)
      WHERE id=$1 AND status='draft'
      RETURNING ${runtimeColumns}`, [versionId, patch.name ?? null, patch.body ?? null, patch.userPromptTemplate ?? null,
      patch.inputSchema ? JSON.stringify(patch.inputSchema) : null, patch.outputSchema ? JSON.stringify(patch.outputSchema) : null,
      patch.applicability ? JSON.stringify(patch.applicability) : null]);
    return result.rows[0] ?? null;
  }

  async copyVersion(versionId: string): Promise<PromptTemplateRuntime | null> {
    const source = await this.getVersion(versionId);
    if (!source) return null;
    const next = await this.pool.query<{ version_no: number }>("SELECT COALESCE(MAX(version_no),0)+1 AS version_no FROM prompt_library.prompt_template_versions WHERE template_id=$1", [source.templateId]);
    const result = await this.pool.query<PromptTemplateRuntime>(`INSERT INTO prompt_library.prompt_template_versions
      (id, template_id, version_no, name, kind, stage, execution_target, input_schema, output_schema, applicability, body, user_prompt_template, status, source_file, source_heading, source_sha256)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft','manual',$12,$13)
      RETURNING ${runtimeColumns}`, [source.templateId, next.rows[0].version_no, source.name, source.kind, source.stage, source.executionTarget,
      JSON.stringify(source.inputSchema), JSON.stringify(source.outputSchema), JSON.stringify(source.applicability), source.body, source.userPromptTemplate,
      `copy:${source.name}`, `${source.sourceSha256}:${next.rows[0].version_no}`]);
    return result.rows[0] ?? null;
  }

  async retireVersion(versionId: string): Promise<PromptTemplateRuntime | null> {
    const result = await this.pool.query<PromptTemplateRuntime>(`UPDATE prompt_library.prompt_template_versions v SET status='retired'
      FROM prompt_library.prompt_templates t WHERE v.id=$1 AND v.template_id=t.id
      RETURNING ${runtimeColumns}`, [versionId]);
    if (result.rows[0]) await this.pool.query("UPDATE prompt_library.prompt_templates SET published_version_id=NULL WHERE published_version_id=$1", [versionId]);
    return result.rows[0] ?? null;
  }
}

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { LibraryAssetStatus, LibraryReference, LibraryRepository, LibraryResource, LibraryResourceQuery } from "../types.js";

type ResourceRow = Omit<LibraryResource, "source"> & { source: Record<string, unknown> };

function mapReference(row: any): LibraryReference {
  return { id: row.id, suiteId: row.suiteId, resourceId: row.resourceId, resourceType: row.resourceType, targetType: row.targetType, targetId: row.targetId, resourceVersionId: row.resourceVersionId, snapshot: row.snapshot, createdAt: row.createdAt, createdBy: row.createdBy ?? null, archivedAt: row.archivedAt ?? null };
}

export class PostgresLibraryRepository implements LibraryRepository {
  constructor(private readonly pool: Pool) {}

  async listResources(query: LibraryResourceQuery) {
    const resources: LibraryResource[] = [];
    const suiteId = query.suiteId ?? null;
    const needle = query.query?.trim() ? `%${query.query.trim()}%` : null;
    if (!query.resourceType || query.resourceType === "prompt_template") {
      const result = await this.pool.query<any>(`SELECT 'prompt:' || v.id::text AS id, 'prompt_template' AS "resourceType", v.name AS title,
        left(regexp_replace(v.body, '\\s+', ' ', 'g'), 180) AS summary, NULL::text AS "mimeType", NULL::text AS "previewUrl",
        NULL::uuid AS "suiteId", NULL::uuid AS "taskId", NULL::uuid AS "imageVersionId", NULL::uuid AS "baseVersionId",
        v.id::text AS "templateVersionId", v.id::text AS "resourceVersionId", v.stage, jsonb_build_object('templateId', t.id::text, 'code', t.code, 'versionNo', v.version_no, 'status', v.status, 'body', v.body, 'userPromptTemplate', v.user_prompt_template, 'inputSchema', v.input_schema, 'outputSchema', v.output_schema, 'applicability', v.applicability) AS source,
        v.status AS status, v.created_at AS "createdAt", COALESCE(v.published_at, v.created_at) AS "updatedAt"
        FROM prompt_library.prompt_templates t JOIN prompt_library.prompt_template_versions v ON v.id = t.published_version_id
        WHERE t.lifecycle_status = 'active' AND v.status = 'published' AND ($1::text IS NULL OR v.stage = $1)
          AND ($2::text IS NULL OR v.name ILIKE $2 OR v.body ILIKE $2) ORDER BY v.created_at DESC`, [query.stage ?? null, needle]);
      resources.push(...result.rows.map((row) => ({ ...row, status: "published" as const })));
    }
    if (!query.resourceType || query.resourceType === "input_image") {
      const result = await this.pool.query<any>(`SELECT 'input:' || i.id::text AS id, 'input_image' AS "resourceType", i.original_filename AS title,
        concat(i.width, ' × ', i.height, ' · ', i.mime_type) AS summary, i.mime_type AS "mimeType",
        '/api/suites/' || i.suite_id::text || '/input-images/' || i.id::text || '/preview/thumbnail' AS "previewUrl",
        i.suite_id AS "suiteId", NULL::uuid AS "taskId", NULL::uuid AS "imageVersionId", NULL::uuid AS "baseVersionId", i.id::text AS "resourceVersionId", NULL::text AS "templateVersionId", NULL::text AS stage,
        jsonb_build_object('objectKey', i.original_object_key, 'originalFilename', i.original_filename, 'ordinal', i.ordinal) AS source, i.created_at AS "createdAt", i.created_at AS "updatedAt"
        FROM suite_workbench.input_images i WHERE ($1::uuid IS NULL OR i.suite_id = $1) AND ($2::text IS NULL OR i.original_filename ILIKE $2) ORDER BY i.created_at DESC`, [suiteId, needle]);
      resources.push(...result.rows.map((row) => ({ ...row, status: "published" as const })));
    }
    if (!query.resourceType || query.resourceType === "base_image") {
      const result = await this.pool.query<any>(`SELECT 'base:' || b.id::text AS id, 'base_image' AS "resourceType", concat('白底底图 · 版本 ', b.version_number) AS title,
        concat(i.original_filename, ' · ', b.width, ' × ', b.height) AS summary, b.mime_type AS "mimeType",
        '/api/suites/' || b.suite_id::text || '/input-images/' || b.input_image_id::text || '/base-versions/' || b.id::text || '/preview' AS "previewUrl",
        b.suite_id AS "suiteId", NULL::uuid AS "taskId", NULL::uuid AS "imageVersionId", b.id AS "baseVersionId", b.id::text AS "resourceVersionId", NULL::text AS "templateVersionId", NULL::text AS stage,
        jsonb_build_object('objectKey', b.object_key, 'inputImageId', b.input_image_id, 'versionNumber', b.version_number, 'promptTemplateVersionId', ga.prompt_template_version_id) AS source,
        jsonb_build_object('prompt', ga.prompt, 'templateVersionId', ga.prompt_template_version_id, 'dynamicInput', ga.dynamic_input_json) AS "promptSnapshot",
        b.created_at AS "createdAt", b.created_at AS "updatedAt"
        FROM suite_workbench.base_image_versions b JOIN suite_workbench.input_images i ON i.id = b.input_image_id JOIN suite_workbench.generation_attempts ga ON ga.id = b.attempt_id
        WHERE ($1::uuid IS NULL OR b.suite_id = $1) AND ($2::text IS NULL OR i.original_filename ILIKE $2) ORDER BY b.created_at DESC`, [suiteId, needle]);
      resources.push(...result.rows.map((row) => ({ ...row, status: "published" as const })));
    }
    if (!query.resourceType || query.resourceType === "task_image_version" || query.resourceType === "process_image") {
      const result = await this.pool.query<any>(`SELECT v.id AS version_id, v.task_id, v.object_key, v.process_object_keys_json, v.prompt_snapshot_json, v.mime_type, v.width, v.height, v.version_number, v.created_at,
        t.suite_id, t.title AS task_title, t.image_type, t.prompt_draft
        FROM suite_workbench.task_image_versions v JOIN suite_workbench.suite_tasks t ON t.id = v.task_id
        WHERE ($1::uuid IS NULL OR t.suite_id = $1) AND ($2::text IS NULL OR t.title ILIKE $2 OR t.prompt_draft ILIKE $2) ORDER BY v.created_at DESC`, [suiteId, needle]);
      for (const row of result.rows) {
        if (!query.resourceType || query.resourceType === "task_image_version") resources.push({ id: `task-version:${row.version_id}`, resourceType: "task_image_version", title: `${row.task_title} · 版本 ${row.version_number}`, summary: `${row.image_type === "main" ? "主图" : "详情页"} · ${row.width} × ${row.height}`, mimeType: row.mime_type, previewUrl: `/api/suite-tasks/${row.task_id}/versions/${row.version_id}/preview`, suiteId: row.suite_id, taskId: row.task_id, imageVersionId: row.version_id, baseVersionId: null, templateVersionId: null, resourceVersionId: row.version_id, stage: "task_image", source: { objectKey: row.object_key, versionNumber: row.version_number, promptSummary: row.prompt_draft.slice(0, 180) }, promptSnapshot: row.prompt_snapshot_json, status: "published", createdAt: row.created_at, updatedAt: row.created_at });
        if ((!query.resourceType || query.resourceType === "process_image") && Array.isArray(row.process_object_keys_json)) row.process_object_keys_json.forEach((objectKey: string, index: number) => resources.push({ id: `process:${row.version_id}:${index}`, resourceType: "process_image", title: `${row.task_title} · 过程图 ${index + 1}`, summary: `${row.image_type === "main" ? "主图" : "详情页"} · 版本 ${row.version_number}`, mimeType: "image/png", previewUrl: null, suiteId: row.suite_id, taskId: row.task_id, imageVersionId: row.version_id, baseVersionId: null, templateVersionId: null, resourceVersionId: `${row.version_id}:${index}`, stage: "task_image", source: { objectKey, versionId: row.version_id, processIndex: index }, promptSnapshot: row.prompt_snapshot_json, status: "published", createdAt: row.created_at, updatedAt: row.created_at }));
      }
    }
    if (!query.resourceType || query.resourceType === "reverse_reference_asset") {
      const result = await this.pool.query<any>(`SELECT id, suite_id AS "suiteId", title, summary, mime_type AS "mimeType", object_key AS "objectKey",
        prompt_snapshot_json AS "promptSnapshot", visual_structure_json AS "visualStructure", source_json AS source, status, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM suite_workbench.reverse_reference_assets
        WHERE ($1::uuid IS NULL OR suite_id = $1 OR suite_id IS NULL) AND ($2::text IS NULL OR title ILIKE $2 OR summary ILIKE $2)
        ORDER BY updated_at DESC`, [suiteId, needle]);
      resources.push(...result.rows.map((row) => ({ id: `reverse:${row.id}`, resourceType: "reverse_reference_asset" as const, title: row.title, summary: row.summary, mimeType: row.mimeType, previewUrl: `/api/library/resources/reverse:${row.id}/preview`, suiteId: row.suiteId, taskId: null, imageVersionId: null, baseVersionId: null, templateVersionId: typeof row.source?.templateVersionId === "string" ? row.source.templateVersionId : null, resourceVersionId: row.id, stage: "task_image" as const, source: { objectKey: row.objectKey, visualStructure: row.visualStructure, ...row.source }, status: row.status, promptSnapshot: row.promptSnapshot, createdAt: row.createdAt, updatedAt: row.updatedAt })));
    }
    if (query.stage && query.resourceType !== "prompt_template") resources.splice(0, resources.length, ...resources.filter((resource) => resource.stage === query.stage));
    if (query.status) resources.splice(0, resources.length, ...resources.filter((resource) => resource.status === query.status));
    for (const resource of resources) {
      const createdAt = resource.createdAt as unknown;
      const updatedAt = resource.updatedAt as unknown;
      resource.createdAt = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
      resource.updatedAt = updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt);
    }
    resources.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const page = Math.max(1, query.page ?? 1); const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
    return { items: resources.slice((page - 1) * pageSize, page * pageSize), total: resources.length, page, pageSize };
  }

  async getResource(resourceId: string) {
    const resourceType = resourceId.startsWith("prompt:") ? "prompt_template" : resourceId.startsWith("input:") ? "input_image" : resourceId.startsWith("base:") ? "base_image" : resourceId.startsWith("task-version:") ? "task_image_version" : resourceId.startsWith("process:") ? "process_image" : resourceId.startsWith("reverse:") ? "reverse_reference_asset" : undefined;
    if (!resourceType) return null;
    const result = await this.listResources({ resourceType, page: 1, pageSize: 1000 });
    return result.items.find((resource) => resource.id === resourceId) ?? null;
  }

  async getPreviewObject(resourceId: string) {
    const resource = await this.getResource(resourceId); const objectKey = typeof resource?.source.objectKey === "string" ? resource.source.objectKey : null;
    return objectKey ? { objectKey } : null;
  }

  async createReference(input: { suiteId: string; resourceId: string; targetType: "plan" | "task"; targetId: string; idempotencyKey: string; createdBy?: string | null }) {
    const resource = await this.getResource(input.resourceId); if (!resource) throw new Error("LIBRARY_RESOURCE_NOT_FOUND");
    if (resource.suiteId && resource.suiteId !== input.suiteId && resource.resourceType !== "base_image") throw new Error("LIBRARY_RESOURCE_FORBIDDEN");
    if (resource.status && resource.status !== "published") throw new Error("LIBRARY_RESOURCE_NOT_PUBLISHED");
    if (resource.resourceType === "process_image") throw new Error("LIBRARY_PROCESS_IMAGE_NOT_SELECTABLE");
    if (resource.resourceType === "prompt_template" && ((input.targetType === "plan" && resource.stage !== "plan") || (input.targetType === "task" && resource.stage !== "task_image"))) throw new Error("LIBRARY_STAGE_MISMATCH");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<any>(`SELECT id, suite_id AS "suiteId", resource_id AS "resourceId", resource_type AS "resourceType", target_type AS "targetType", target_id AS "targetId", resource_version_id AS "resourceVersionId", snapshot_json AS snapshot, created_at AS "createdAt", created_by AS "createdBy", archived_at AS "archivedAt" FROM suite_workbench.library_references WHERE suite_id=$1 AND idempotency_key=$2`, [input.suiteId, input.idempotencyKey]);
      if (existing.rows[0]) { await client.query("COMMIT"); return { reference: mapReference(existing.rows[0]), duplicate: true }; }
      const targetExists = input.targetType === "task"
        ? await client.query("SELECT 1 FROM suite_workbench.suite_tasks WHERE id=$1 AND suite_id=$2", [input.targetId, input.suiteId])
        : await client.query("SELECT 1 FROM suite_workbench.plan_snapshots WHERE id=$1 AND suite_id=$2", [input.targetId, input.suiteId]);
      if (!targetExists.rowCount) throw new Error("LIBRARY_TARGET_NOT_FOUND");
      const duplicate = await client.query<any>(`SELECT id, suite_id AS "suiteId", resource_id AS "resourceId", resource_type AS "resourceType", target_type AS "targetType", target_id AS "targetId", resource_version_id AS "resourceVersionId", snapshot_json AS snapshot, created_at AS "createdAt", created_by AS "createdBy", archived_at AS "archivedAt" FROM suite_workbench.library_references WHERE suite_id=$1 AND resource_id=$2 AND target_type=$3 AND target_id=$4 AND archived_at IS NULL`, [input.suiteId, input.resourceId, input.targetType, input.targetId]);
      if (duplicate.rows[0]) { await client.query("INSERT INTO suite_workbench.library_references (id,suite_id,resource_id,resource_type,target_type,target_id,resource_version_id,snapshot_json,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [randomUUID(), input.suiteId, input.resourceId, resource.resourceType, input.targetType, input.targetId, resource.resourceVersionId, JSON.stringify({ ...resource, previewUrl: undefined }), input.idempotencyKey, input.createdBy ?? null]).catch(() => undefined); await client.query("COMMIT"); return { reference: mapReference(duplicate.rows[0]), duplicate: true }; }
      const result = await client.query<any>(`INSERT INTO suite_workbench.library_references (id,suite_id,resource_id,resource_type,target_type,target_id,resource_version_id,snapshot_json,idempotency_key,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, suite_id AS "suiteId", resource_id AS "resourceId", resource_type AS "resourceType", target_type AS "targetType", target_id AS "targetId", resource_version_id AS "resourceVersionId", snapshot_json AS snapshot, created_at AS "createdAt", created_by AS "createdBy", archived_at AS "archivedAt"`, [randomUUID(), input.suiteId, input.resourceId, resource.resourceType, input.targetType, input.targetId, resource.resourceVersionId, JSON.stringify({ ...resource, previewUrl: undefined }), input.idempotencyKey, input.createdBy ?? null]);
      await client.query("COMMIT"); return { reference: mapReference(result.rows[0]), duplicate: false };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async listReferences(suiteId: string, targetType?: "plan" | "task", targetId?: string) {
    const result = await this.pool.query<any>(`SELECT id, suite_id AS "suiteId", resource_id AS "resourceId", resource_type AS "resourceType", target_type AS "targetType", target_id AS "targetId", resource_version_id AS "resourceVersionId", snapshot_json AS snapshot, created_at AS "createdAt", created_by AS "createdBy", archived_at AS "archivedAt" FROM suite_workbench.library_references WHERE suite_id=$1 AND archived_at IS NULL AND ($2::text IS NULL OR target_type=$2) AND ($3::text IS NULL OR target_id=$3) ORDER BY created_at DESC`, [suiteId, targetType ?? null, targetId ?? null]);
    return result.rows.map(mapReference);
  }

  async archiveReference(suiteId: string, referenceId: string) {
    const result = await this.pool.query<any>(`UPDATE suite_workbench.library_references SET archived_at=COALESCE(archived_at, now()) WHERE suite_id=$1 AND id=$2 RETURNING id, suite_id AS "suiteId", resource_id AS "resourceId", resource_type AS "resourceType", target_type AS "targetType", target_id AS "targetId", resource_version_id AS "resourceVersionId", snapshot_json AS snapshot, created_at AS "createdAt", created_by AS "createdBy", archived_at AS "archivedAt"`, [suiteId, referenceId]);
    return result.rows[0] ? mapReference(result.rows[0]) : null;
  }

  async createReverseReferenceAsset(input: { suiteId?: string | null; title: string; summary?: string; objectKey: string; mimeType: string; promptSnapshot: Record<string, unknown>; visualStructure?: Record<string, unknown>; source?: Record<string, unknown> }): Promise<LibraryResource> {
    const result = await this.pool.query<any>(`INSERT INTO suite_workbench.reverse_reference_assets (suite_id,title,summary,object_key,mime_type,prompt_snapshot_json,visual_structure_json,source_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, suite_id AS "suiteId", title, summary, mime_type AS "mimeType", object_key AS "objectKey", prompt_snapshot_json AS "promptSnapshot", visual_structure_json AS "visualStructure", source_json AS source, status, created_at AS "createdAt", updated_at AS "updatedAt"`, [input.suiteId ?? null, input.title, input.summary ?? "", input.objectKey, input.mimeType, JSON.stringify(input.promptSnapshot), JSON.stringify(input.visualStructure ?? {}), JSON.stringify(input.source ?? {})]);
    const row = result.rows[0];
    return { id: `reverse:${row.id}`, resourceType: "reverse_reference_asset", title: row.title, summary: row.summary, mimeType: row.mimeType, previewUrl: `/api/library/resources/reverse:${row.id}/preview`, suiteId: row.suiteId, taskId: null, imageVersionId: null, baseVersionId: null, templateVersionId: typeof row.source?.templateVersionId === "string" ? row.source.templateVersionId : null, resourceVersionId: row.id, stage: "task_image", source: { objectKey: row.objectKey, visualStructure: row.visualStructure, ...row.source }, status: row.status, promptSnapshot: row.promptSnapshot, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  async setResourceStatus(resourceId: string, status: LibraryAssetStatus): Promise<LibraryResource | null> {
    if (!resourceId.startsWith("reverse:")) return null;
    const result = await this.pool.query<any>(`UPDATE suite_workbench.reverse_reference_assets SET status=$2, updated_at=now(), archived_at=CASE WHEN $2='archived' THEN COALESCE(archived_at,now()) ELSE archived_at END WHERE id=$1::uuid RETURNING id, suite_id AS "suiteId", title, summary, mime_type AS "mimeType", object_key AS "objectKey", prompt_snapshot_json AS "promptSnapshot", visual_structure_json AS "visualStructure", source_json AS source, status, created_at AS "createdAt", updated_at AS "updatedAt"`, [resourceId.slice("reverse:".length), status]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { id: resourceId, resourceType: "reverse_reference_asset", title: row.title, summary: row.summary, mimeType: row.mimeType, previewUrl: `/api/library/resources/${resourceId}/preview`, suiteId: row.suiteId, taskId: null, imageVersionId: null, baseVersionId: null, templateVersionId: typeof row.source?.templateVersionId === "string" ? row.source.templateVersionId : null, resourceVersionId: row.id, stage: "task_image", source: { objectKey: row.objectKey, visualStructure: row.visualStructure, ...row.source }, status: row.status, promptSnapshot: row.promptSnapshot, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
}

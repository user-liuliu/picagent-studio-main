import type { Pool } from "pg";
import type { RagChunk, RagChunkRef, RagChunkSummary, RagClient } from "../types.js";

const columns = `id, source_version AS version, title, summary, content, field_values_json AS "fieldValues", source_kind AS "sourceKind", source_asset_paths_json AS "sourceAssetPaths", content_sha256 AS "contentSha256", status = 'published' AS published`;
export class PostgresRagClient implements RagClient {
  constructor(private readonly pool: Pool) {}
  async search(query: string): Promise<RagChunkSummary[]> {
    const pattern = `%${query.trim()}%`;
    const result = await this.pool.query<RagChunk>(`SELECT ${columns} FROM suite_workbench.validation_rag_chunks WHERE status='published' AND ($1='' OR title ILIKE $2 OR summary ILIKE $2 OR content ILIKE $2) ORDER BY title LIMIT 30`, [query.trim(), pattern]);
    return result.rows.map(({ content: _content, published: _published, ...summary }) => summary);
  }
  async getByIds(refs: RagChunkRef[]): Promise<RagChunk[]> {
    if (!refs.length) return [];
    const result = await this.pool.query<RagChunk>(`SELECT ${columns} FROM suite_workbench.validation_rag_chunks WHERE id = ANY($1::text[])`, [refs.map((ref) => ref.id)]);
    return result.rows;
  }
}

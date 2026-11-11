import fs from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

export async function runMigrations(pool: Pool, options: { recoverStaleAttempts?: boolean } = {}): Promise<void> {
  const directory = path.resolve("db/migrations");
  const files = (await fs.readdir(directory)).filter((file) => /^\d{3}_.+\.sql$/.test(file)).sort();
  for (const file of files) await pool.query(await fs.readFile(path.join(directory, file), "utf8"));
  if (options.recoverStaleAttempts) {
    await pool.query("UPDATE suite_workbench.generation_attempts SET status = 'failed', error_code = 'GENERATION_INTERRUPTED', error_message = '生成服务中断，请重新精修', completed_at = now() WHERE status = 'running'");
    await pool.query("UPDATE suite_workbench.plan_generation_attempts SET status = 'failed', error_code = 'GENERATION_INTERRUPTED', error_message = '计划生成服务中断，请重新生成', completed_at = now() WHERE status = 'running'");
    await pool.query("UPDATE suite_workbench.plan_category_requests SET status = 'failed', error_code = 'GENERATION_INTERRUPTED', error_message = '类别提示词生成服务中断，请重试', completed_at = now() WHERE status = 'running'");
    await pool.query("UPDATE suite_workbench.reverse_attempts SET status = 'failed', error_code = 'GENERATION_INTERRUPTED', error_message = '反推服务中断，请重新反推', completed_at = now() WHERE status = 'running'");
    await pool.query("UPDATE suite_workbench.image_edit_attempts SET status = 'failed', error_code = 'GENERATION_INTERRUPTED', error_message = '图片编辑服务中断，请重试', completed_at = now() WHERE status = 'generating'");
    await pool.query("UPDATE suite_workbench.image_edit_child_tasks SET status = 'failed', error_code = 'GENERATION_INTERRUPTED', error_message = '图片编辑服务中断，请重试', updated_at = now() WHERE status = 'generating'");
  }
}

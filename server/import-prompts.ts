import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { loadPostgresConfig } from "./config.js";
import { isNormalizedPromptMarkdown, parseNormalizedPromptMarkdown, parsePromptMarkdown, type PromptTemplateRecord } from "./prompt-library.js";
import { PostgresPromptRepository } from "./repositories/postgres-prompt-repository.js";
import { runMigrations } from "./migrations.js";

const sourceArgs = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const sources = sourceArgs.length ? sourceArgs : ["prompt/prompt.md"];
const dryRun = process.argv.includes("--dry-run");
const publish = process.argv.includes("--publish");
const replace = process.argv.includes("--replace");
const records: PromptTemplateRecord[] = [];
for (const sourceArgument of sources) {
  const source = path.resolve(sourceArgument);
  const markdown = await readFile(source, "utf8");
  const relative = path.relative(process.cwd(), source);
  if (isNormalizedPromptMarkdown(markdown)) records.push(parseNormalizedPromptMarkdown(markdown, relative));
  else records.push(...parsePromptMarkdown(markdown, relative));
}
const summary = { sources: sources.map((source) => path.relative(process.cwd(), path.resolve(source))), count: records.length, templates: records.map(({ code, name, stage, kind }) => ({ code, name, stage, kind })) };
if (dryRun) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }
const pool = new Pool({ ...loadPostgresConfig(), max: 2, connectionTimeoutMillis: 30_000 });
try {
  await runMigrations(pool);
  const repository = new PostgresPromptRepository(pool);
  if (replace) await repository.pruneExcept(records.map((record) => record.code));
  const imported = await repository.importRecords(records);
  if (publish) for (const version of imported) await repository.publishVersion(version.templateVersionId);
  console.log(JSON.stringify({ ...summary, imported: true, published: publish, versions: imported.map(({ templateVersionId, versionNo }) => ({ templateVersionId, versionNo })) }, null, 2));
}
finally { await pool.end(); }

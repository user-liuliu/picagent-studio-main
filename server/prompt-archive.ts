import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

export type ModelArchiveType = "multimodal-plan" | "multimodal-category-prompt" | "image-generation";

export interface ModelArchiveSession {
  directory: string;
  stem: string;
  requestPath: string;
  startedAt: string;
}

interface ArchiveFile {
  label: string;
  mimeType: string;
  bytes: Buffer;
  filename?: string;
}

function fileTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "unknown";
}

function extension(file: ArchiveFile): string {
  const existing = file.filename ? extname(file.filename) : "";
  if (existing) return existing.toLowerCase();
  if (file.mimeType === "image/png") return ".png";
  if (file.mimeType === "image/jpeg") return ".jpg";
  if (file.mimeType === "image/webp") return ".webp";
  return ".bin";
}

async function writeArchiveFiles(session: ModelArchiveSession, files: ArchiveFile[], suffix: "input" | "output") {
  const saved: Array<{ label: string; mimeType: string; byteLength: number; file: string }> = [];
  for (const [index, file] of files.entries()) {
    const name = `${session.stem}_${suffix}-${String(index + 1).padStart(2, "0")}-${safePart(file.label)}${extension(file)}`;
    await writeFile(join(session.directory, name), file.bytes);
    saved.push({ label: file.label, mimeType: file.mimeType, byteLength: file.bytes.length, file: name });
  }
  return saved;
}

export async function startModelArchive(input: {
  type: ModelArchiveType;
  flow: string;
  requestId: string;
  provider: string;
  model: string;
  request: unknown;
  inputFiles?: ArchiveFile[];
}): Promise<ModelArchiveSession> {
  const createdAt = new Date();
  const directory = join("var", "model-archives", input.type, createdAt.toISOString().slice(0, 10));
  await mkdir(directory, { recursive: true });
  const stem = `${fileTimestamp(createdAt)}_${input.type}_${safePart(input.flow)}_${safePart(input.requestId)}`;
  const session = { directory, stem, requestPath: join(directory, `${stem}_request.json`), startedAt: createdAt.toISOString() };
  const files = await writeArchiveFiles(session, input.inputFiles ?? [], "input");
  await writeFile(session.requestPath, `${JSON.stringify({
    type: input.type,
    flow: input.flow,
    requestId: input.requestId,
    createdAt: session.startedAt,
    provider: input.provider,
    model: input.model,
    request: input.request,
    files,
  }, null, 2)}\n`, "utf8");
  return session;
}

export async function finishModelArchive(session: ModelArchiveSession, response: unknown, outputFiles: ArchiveFile[] = []): Promise<string> {
  const completedAt = new Date();
  const files = await writeArchiveFiles(session, outputFiles, "output");
  const responsePath = join(session.directory, `${session.stem}_response.json`);
  await writeFile(responsePath, `${JSON.stringify({
    status: "succeeded",
    startedAt: session.startedAt,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - new Date(session.startedAt).getTime(),
    response,
    files,
  }, null, 2)}\n`, "utf8");
  return responsePath;
}

export async function failModelArchive(session: ModelArchiveSession, error: unknown, response?: unknown): Promise<string> {
  const completedAt = new Date();
  const responsePath = join(session.directory, `${session.stem}_response.json`);
  await writeFile(responsePath, `${JSON.stringify({
    status: "failed",
    startedAt: session.startedAt,
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - new Date(session.startedAt).getTime(),
    error: error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) },
    response,
  }, null, 2)}\n`, "utf8");
  return responsePath;
}

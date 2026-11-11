import { config as loadDotenv } from "dotenv";

loadDotenv({ override: false });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function positiveInteger(name: string, fallback?: number): number {
  const raw = process.env[name]?.trim();
  if (!raw && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid configuration: ${name}`);
  return value;
}

export function loadPostgresConfig() {
  return {
    host: required("PG_HOST"),
    port: positiveInteger("PG_PORT", 5432),
    database: required("PG_DATABASE"),
    user: required("PG_USER"),
    password: required("PG_PASSWORD"),
    ssl: process.env.PG_SSL?.trim() === "true" ? { rejectUnauthorized: false } : undefined,
  };
}

export function loadServerConfig() {
  const minioEndpoint = new URL(required("MINIO_ENDPOINT"));
  const imageGenerationBaseUrl = new URL(required("IMAGE_GENERATION_BASE_URL"));
  const imageGenerationModel = required("IMAGE_GENERATION_MODEL");
  if (minioEndpoint.pathname !== "/") throw new Error("MINIO_ENDPOINT must not contain a path");
  if (imageGenerationModel !== "gpt-image-2") throw new Error("IMAGE_GENERATION_MODEL must be gpt-image-2");
  return {
    port: positiveInteger("PORT", 3001),
    postgres: loadPostgresConfig(),
    minio: {
      endPoint: minioEndpoint.hostname,
      port: minioEndpoint.port ? Number(minioEndpoint.port) : minioEndpoint.protocol === "https:" ? 443 : 80,
      useSSL: minioEndpoint.protocol === "https:",
      accessKey: required("MINIO_ACCESS_KEY"),
      secretKey: required("MINIO_SECRET_KEY"),
      region: process.env.MINIO_REGION?.trim() || "us-east-1",
      bucket: required("MINIO_BUCKET"),
      legacyBucket: process.env.MINIO_LEGACY_BUCKET?.trim() || undefined,
    },
    imageGeneration: {
      baseUrl: imageGenerationBaseUrl.toString(),
      apiKey: required("IMAGE_GENERATION_API_KEY"),
      model: "gpt-image-2" as const,
      timeoutMs: positiveInteger("IMAGE_GENERATION_TIMEOUT_MS", 600_000),
    },
    llm: process.env.CONTEXT_BASE_URL?.trim() && process.env.CONTEXT_API_KEY?.trim() && process.env.CONTEXT_MODEL?.trim() ? {
      baseUrl: new URL(process.env.CONTEXT_BASE_URL.trim()).toString(),
      apiKey: process.env.CONTEXT_API_KEY.trim(),
      model: process.env.CONTEXT_MODEL.trim(),
      timeoutMs: positiveInteger("CONTEXT_TIMEOUT_MS", 300_000),
    } : null,
  };
}

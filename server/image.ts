import crypto from "node:crypto";
import sharp from "sharp";

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ProcessedImage { sha256: string; width: number; height: number; mimeType: string; thumbnail: Buffer; generationInput: Buffer }
export interface ProcessedGeneratedImage { bytes: Buffer; sha256: string; width: number; height: number; mimeType: "image/png" }

export async function processImage(bytes: Buffer, claimedMime: string): Promise<ProcessedImage> {
  if (!MIME_TYPES.has(claimedMime)) throw new Error("UNSUPPORTED_IMAGE_MIME");
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("IMAGE_TOO_LARGE");
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => null);
  if (!metadata?.width || !metadata.height || !metadata.format) throw new Error("INVALID_IMAGE");
  const actualMime = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
  if (actualMime !== claimedMime) throw new Error("MIME_MISMATCH");
  if (metadata.width * metadata.height > MAX_PIXELS) throw new Error("IMAGE_DIMENSIONS_TOO_LARGE");
  const thumbnail = await sharp(bytes).rotate().resize({ width: 420, height: 280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const generationInput = await sharp(bytes).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return { sha256: crypto.createHash("sha256").update(bytes).digest("hex"), width: metadata.width, height: metadata.height, mimeType: actualMime, thumbnail, generationInput };
}

export async function processGeneratedImage(bytes: Buffer): Promise<ProcessedGeneratedImage> {
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("INVALID_GENERATED_IMAGE");
  const output = await sharp(bytes, { failOn: "error" }).rotate().png().toBuffer({ resolveWithObject: true }).catch(() => null);
  if (!output?.info.width || !output.info.height || output.info.width * output.info.height > MAX_PIXELS) throw new Error("INVALID_GENERATED_IMAGE");
  return {
    bytes: output.data,
    sha256: crypto.createHash("sha256").update(output.data).digest("hex"),
    width: output.info.width,
    height: output.info.height,
    mimeType: "image/png",
  };
}

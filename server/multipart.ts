export function decodeMultipartFilename(filenameStar: string | undefined, filenameHeader: string | undefined): string {
  if (filenameStar) return decodeURIComponent(filenameStar);
  if (!filenameHeader) return "upload";
  return Buffer.from(filenameHeader, "latin1").toString("utf8");
}

export function parseMultipartFile(body: Buffer, contentType: string): { filename: string; mimeType: string; bytes: Buffer } | null {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary}`, "latin1");
  const start = body.indexOf(marker);
  if (start < 0) return null;
  const headerStart = start + marker.length + 2;
  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n", "latin1"), headerStart);
  if (headerEnd < 0) return null;
  const headers = body.subarray(headerStart, headerEnd).toString("latin1");
  const disposition = headers.match(/content-disposition:[^\r\n]*filename\*=[^']*''([^;\r\n]+)|content-disposition:[^\r\n]*filename="([^"]+)"/i);
  const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
  if (!disposition || !mimeType) return null;
  const dataStart = headerEnd + 4;
  const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`, "latin1"), dataStart);
  if (nextBoundary < 0) return null;
  return { filename: decodeMultipartFilename(disposition[1], disposition[2]), mimeType, bytes: body.subarray(dataStart, nextBoundary) };
}

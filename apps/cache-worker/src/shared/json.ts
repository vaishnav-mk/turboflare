export interface JsonReadResult {
  tooLarge: boolean;
  value?: unknown;
}

export type BoundedBytesResult =
  | { bytes?: Uint8Array; tooLarge: true }
  | { bytes: Uint8Array; tooLarge: false };

export async function readBoundedJson(request: Request, maxBytes: number): Promise<JsonReadResult> {
  const body = await readBoundedText(request, maxBytes);
  if (body.tooLarge) {
    return { tooLarge: true };
  }

  try {
    return { tooLarge: false, value: JSON.parse(body.text) as unknown };
  } catch {
    return { tooLarge: false };
  }
}

export function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<{ text: string; tooLarge: boolean }> {
  const contentLength = request.headers.get("Content-Length");
  const hasValidLength = contentLength === null || /^\d+$/.test(contentLength);
  const parsedLength = contentLength === null ? 0 : Number(contentLength);
  if (contentLength !== null && (!hasValidLength || parsedLength > maxBytes)) {
    return { text: "", tooLarge: true };
  }

  if (request.body === null) {
    return { text: "", tooLarge: false };
  }

  const result = await readBoundedBytes(request.body, maxBytes);
  if (result.tooLarge) {
    return { text: "", tooLarge: true };
  }

  const decoder = new TextDecoder();
  const text = decoder.decode(result.bytes);
  return { text, tooLarge: false };
}

export async function readBoundedBytes(
  body: ReadableStream,
  maxBytes: number,
): Promise<BoundedBytesResult> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }

    chunks.push(value);
  }

  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes: buffer, tooLarge: false };
}

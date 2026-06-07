const TEXT_ENCODER = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

export function recordUtf8ByteLength(record: Record<string, string>): number {
  let size = 0;
  const entries = Object.entries(record);
  for (const [key, value] of entries) {
    const keySize = utf8ByteLength(key);
    const valueSize = utf8ByteLength(value);
    size += keySize + valueSize;
  }

  return size;
}

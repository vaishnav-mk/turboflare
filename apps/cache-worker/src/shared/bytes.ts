const TEXT_ENCODER = new TextEncoder();

export function utf8ByteLength(value: string): number {
	return TEXT_ENCODER.encode(value).byteLength;
}

export function recordUtf8ByteLength(record: Record<string, string>): number {
	return Object.entries(record).reduce((size, [key, value]) => size + utf8ByteLength(key) + utf8ByteLength(value), 0);
}

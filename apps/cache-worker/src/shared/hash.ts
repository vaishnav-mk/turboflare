export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
	const buffer = bytes instanceof Uint8Array ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : bytes;
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

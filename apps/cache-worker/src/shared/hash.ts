export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  let bytes: ArrayBuffer | Uint8Array;
  if (typeof input === "string") {
    const encoder = new TextEncoder();
    bytes = encoder.encode(input);
  } else {
    bytes = input;
  }
  const buffer =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const digestBytes = new Uint8Array(digest);
  const hexBytes = [...digestBytes].map((byte) => {
    const hex = byte.toString(16);
    return hex.padStart(2, "0");
  });
  return hexBytes.join("");
}

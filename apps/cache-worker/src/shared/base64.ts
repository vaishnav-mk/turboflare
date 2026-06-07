export function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 = btoa(binary);
  const urlSafeBase64 = base64.replaceAll("+", "-");
  const withoutSlash = urlSafeBase64.replaceAll("/", "_");
  return withoutSlash.replaceAll("=", "");
}

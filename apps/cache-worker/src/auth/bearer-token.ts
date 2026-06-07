export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (authorization === null) {
    return null;
  }

  const trimmed = authorization.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer" || token.length === 0) {
    return null;
  }

  return token;
}

export function timingSafeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    diff |= leftCode ^ rightCode;
  }

  return diff === 0;
}

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

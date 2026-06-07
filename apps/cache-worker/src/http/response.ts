interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export enum ErrorCode {
  AlreadyExists = "already_exists",
  ArtifactTooLarge = "artifact_too_large",
  BadRequest = "bad_request",
  Forbidden = "forbidden",
  InternalError = "internal_error",
  MethodNotAllowed = "method_not_allowed",
  NotFound = "not_found",
  PayloadTooLarge = "payload_too_large",
  RateLimited = "rate_limited",
  SignatureRequired = "signature_required",
  Unauthorized = "unauthorized",
  Unavailable = "unavailable",
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  const responseBody = JSON.stringify(body);

  return new Response(responseBody, {
    ...init,
    headers,
  });
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  headers?: HeadersInit,
): Response {
  const body = { error: { code, message } } satisfies ErrorBody;
  const init = { status, headers };
  return jsonResponse(body, init);
}

export function methodNotAllowed(methods: string[]): Response {
  const allow = methods.join(", ");
  return errorResponse(405, ErrorCode.MethodNotAllowed, "Method not allowed", { Allow: allow });
}

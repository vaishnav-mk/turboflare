import { ArtifactHeader, type ArtifactLookupHit } from "@turboflare/protocol";

import type { AuthContext } from "../auth/types";
import { ErrorCode, errorResponse } from "../http/response";
import { recordUtf8ByteLength } from "../shared/bytes";
import { parseDurationMs } from "../shared/duration";
import type { TenantContext } from "../tenancy/types";
import { MAX_CUSTOM_METADATA_BYTES, OCTET_STREAM } from "./constants";

export interface ArtifactMetadataObject {
  customMetadata?: Record<string, string>;
  httpEtag: string;
  httpMetadata?: {
    contentType?: string;
  };
  size: number;
  uploaded: Date;
}

export interface ArtifactBodyObject extends ArtifactMetadataObject {
  body: ReadableStream;
}

export function artifactCustomMetadata(
  request: Request,
  url: URL,
  tenant: TenantContext,
  artifactId: string,
  authContext: AuthContext,
): Record<string, string> | Response {
  const rawDuration = request.headers.get(ArtifactHeader.Duration);
  const duration = normalizedDuration(rawDuration);
  if (duration instanceof Response) {
    return duration;
  }

  const createdAt = new Date();
  const metadata: Record<string, string> = {
    artifactId,
    createdAt: createdAt.toISOString(),
    duration,
    team: tenant.key,
    teamSource: tenant.source,
    tokenId: authContext.tokenId,
  };

  const teamId = url.searchParams.get("teamId");
  const teamAlias = url.searchParams.get("team");
  const slug = url.searchParams.get("slug");
  const tag = request.headers.get(ArtifactHeader.Tag);
  const sha = request.headers.get(ArtifactHeader.Sha);
  const dirtyHash = request.headers.get(ArtifactHeader.DirtyHash);
  const clientCi = request.headers.get(ArtifactHeader.ClientCi);
  const clientInteractive = request.headers.get(ArtifactHeader.ClientInteractive);
  setMetadata(metadata, "teamId", teamId);
  setMetadata(metadata, "teamAlias", teamAlias);
  setMetadata(metadata, "slug", slug);
  setMetadata(metadata, "tag", tag);
  setMetadata(metadata, "sha", sha);
  setMetadata(metadata, "dirtyHash", dirtyHash);
  setMetadata(metadata, "clientCi", clientCi);
  setMetadata(metadata, "clientInteractive", clientInteractive);
  setMetadata(metadata, "branch", tenant.branch ?? null);
  setMetadata(metadata, "fallbackBranch", tenant.fallbackBranch ?? null);

  if (recordUtf8ByteLength(metadata) > MAX_CUSTOM_METADATA_BYTES) {
    return errorResponse(400, ErrorCode.BadRequest, "Artifact metadata is too large");
  }

  return metadata;
}

export function artifactResponseHeaders(object: ArtifactMetadataObject): Headers {
  const metadata = object.customMetadata ?? {};
  const headers = new Headers();
  const contentLength = object.size.toString();
  const lastModified = object.uploaded.toUTCString();
  headers.set("Content-Type", object.httpMetadata?.contentType ?? OCTET_STREAM);
  headers.set("Content-Length", contentLength);
  headers.set("ETag", object.httpEtag);
  headers.set("Last-Modified", lastModified);

  headers.set(ArtifactHeader.Duration, metadata.duration ?? "0");
  setHeader(headers, ArtifactHeader.Tag, metadata.tag);
  setHeader(headers, ArtifactHeader.Sha, metadata.sha);
  setHeader(headers, ArtifactHeader.DirtyHash, metadata.dirtyHash);
  return headers;
}

export function lookupHit(object: ArtifactMetadataObject): ArtifactLookupHit {
  const metadata = object.customMetadata ?? {};
  return {
    size: object.size,
    taskDurationMs: parseDurationMs(metadata.duration),
    ...(metadata.tag !== undefined ? { tag: metadata.tag } : {}),
  };
}

function normalizedDuration(value: string | null): string | Response {
  if (value === null || value.length === 0) {
    return "0";
  }

  if (!/^\d+$/.test(value)) {
    return errorResponse(
      400,
      ErrorCode.BadRequest,
      "x-artifact-duration must be a non-negative integer",
    );
  }

  return value;
}

function setMetadata(metadata: Record<string, string>, key: string, value: string | null): void {
  if (value !== null) {
    metadata[key] = value;
  }
}

function setHeader(headers: Headers, key: string, value: string | undefined): void {
  if (value !== undefined) {
    headers.set(key, value);
  }
}

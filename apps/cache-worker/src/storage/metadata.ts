import { ArtifactHeader, type ArtifactLookupHit } from "@turboflare/protocol";
import { errorResponse } from "@turboflare/shared";

import type { AuthContext } from "../auth/types";
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
	authContext: AuthContext
): Record<string, string> | Response {
	const duration = normalizedDuration(request.headers.get(ArtifactHeader.Duration));
	if (duration instanceof Response) {
		return duration;
	}

	const metadata: Record<string, string> = {
		artifactId,
		createdAt: new Date().toISOString(),
		duration,
		team: tenant.key,
		teamSource: tenant.source,
		tokenId: authContext.tokenId,
	};

	setMetadata(metadata, "teamId", url.searchParams.get("teamId"));
	setMetadata(metadata, "teamAlias", url.searchParams.get("team"));
	setMetadata(metadata, "slug", url.searchParams.get("slug"));
	setMetadata(metadata, "tag", request.headers.get(ArtifactHeader.Tag));
	setMetadata(metadata, "sha", request.headers.get(ArtifactHeader.Sha));
	setMetadata(metadata, "dirtyHash", request.headers.get(ArtifactHeader.DirtyHash));
	setMetadata(metadata, "clientCi", request.headers.get(ArtifactHeader.ClientCi));
	setMetadata(metadata, "clientInteractive", request.headers.get(ArtifactHeader.ClientInteractive));

	if (recordUtf8ByteLength(metadata) > MAX_CUSTOM_METADATA_BYTES) {
		return errorResponse(400, "bad_request", "Artifact metadata is too large");
	}

	return metadata;
}

export function artifactResponseHeaders(object: ArtifactMetadataObject): Headers {
	const metadata = object.customMetadata ?? {};
	const headers = new Headers();
	headers.set("Content-Type", object.httpMetadata?.contentType ?? OCTET_STREAM);
	headers.set("Content-Length", object.size.toString());
	headers.set("ETag", object.httpEtag);
	headers.set("Last-Modified", object.uploaded.toUTCString());
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
		return errorResponse(400, "bad_request", "x-artifact-duration must be a non-negative integer");
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

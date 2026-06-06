import { errorResponse } from "../http/response";
import { utf8ByteLength } from "../shared/bytes";
import type { TenantContext } from "../tenancy/types";
import { ARTIFACT_NAMESPACE_VERSION, MAX_R2_KEY_BYTES } from "./constants";

export function artifactKey(tenant: TenantContext, artifactId: string): string | Response {
	const key = artifactKeyForBranch(tenant, artifactId, tenant.branch);
	if (utf8ByteLength(key) > MAX_R2_KEY_BYTES) {
		return errorResponse(400, "bad_request", "Artifact key is too long");
	}

	return key;
}

export function fallbackArtifactKey(tenant: TenantContext, artifactId: string): string | Response | null {
	if (tenant.fallbackBranch === undefined) {
		return null;
	}

	const key = artifactKeyForBranch(tenant, artifactId, tenant.fallbackBranch.length === 0 ? undefined : tenant.fallbackBranch);
	if (utf8ByteLength(key) > MAX_R2_KEY_BYTES) {
		return errorResponse(400, "bad_request", "Artifact key is too long");
	}

	return key;
}

export function teamKeyPrefix(team: string): string {
	return `${ARTIFACT_NAMESPACE_VERSION}/team/${safeKeyPart(team)}/`;
}

function artifactKeyForBranch(tenant: TenantContext, artifactId: string, branch: string | undefined): string {
	const teamPrefix = teamKeyPrefix(tenant.key);
	const artifactPart = `artifact/${safeKeyPart(artifactId)}`;
	return branch === undefined ? `${teamPrefix}${artifactPart}` : `${teamPrefix}branch/${safeKeyPart(branch)}/${artifactPart}`;
}

function safeKeyPart(value: string): string {
	return encodeURIComponent(value);
}

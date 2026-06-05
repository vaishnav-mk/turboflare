import { errorResponse } from "../http/response";
import { utf8ByteLength } from "../shared/bytes";
import type { TenantContext } from "../tenancy/types";
import { ARTIFACT_NAMESPACE_VERSION, MAX_R2_KEY_BYTES } from "./constants";

export function artifactKey(tenant: TenantContext, artifactId: string): string | Response {
	const key = `${ARTIFACT_NAMESPACE_VERSION}/team/${safeKeyPart(tenant.key)}/artifact/${safeKeyPart(artifactId)}`;
	if (utf8ByteLength(key) > MAX_R2_KEY_BYTES) {
		return errorResponse(400, "bad_request", "Artifact key is too long");
	}

	return key;
}

function safeKeyPart(value: string): string {
	return encodeURIComponent(value);
}

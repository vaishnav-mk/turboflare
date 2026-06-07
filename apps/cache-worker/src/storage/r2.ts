import type { Env } from "../app/env";
import { OCTET_STREAM } from "./constants";

export async function putR2Artifact(
  env: Env,
  key: string,
  body: ReadableStream,
  customMetadata: Record<string, string>,
): Promise<R2Object> {
  return env.ARTIFACTS.put(key, body, {
    httpMetadata: {
      contentType: OCTET_STREAM,
    },
    customMetadata,
  });
}

export function getR2Artifact(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.ARTIFACTS.get(key);
}

export function headR2Artifact(env: Env, key: string): Promise<R2Object | null> {
  return env.ARTIFACTS.head(key);
}

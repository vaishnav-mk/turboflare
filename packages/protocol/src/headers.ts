import { HttpMethod } from "./methods";

export enum ArtifactHeader {
  ClientCi = "x-artifact-client-ci",
  ClientInteractive = "x-artifact-client-interactive",
  DirtyHash = "x-artifact-dirty-hash",
  Duration = "x-artifact-duration",
  Sha = "x-artifact-sha",
  Tag = "x-artifact-tag",
}

export const ARTIFACT_RESPONSE_HEADERS = [
  "Content-Length",
  "ETag",
  "Last-Modified",
  ArtifactHeader.Duration,
  ArtifactHeader.Tag,
  ArtifactHeader.Sha,
  ArtifactHeader.DirtyHash,
] as const;

export const ARTIFACT_EXPOSE_HEADERS = ARTIFACT_RESPONSE_HEADERS.join(", ");

export const PREFLIGHT_ALLOW_HEADERS = [
  "Authorization",
  "Content-Type",
  "User-Agent",
  ArtifactHeader.Duration,
  ArtifactHeader.Tag,
  ArtifactHeader.Sha,
  ArtifactHeader.DirtyHash,
  ArtifactHeader.ClientCi,
  ArtifactHeader.ClientInteractive,
] as const;

export const PREFLIGHT_ALLOW_METHODS = [
  HttpMethod.Get,
  HttpMethod.Head,
  HttpMethod.Put,
  HttpMethod.Post,
  HttpMethod.Options,
] as const;

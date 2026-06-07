export interface ArtifactLookupRequest {
  hashes: string[];
}

export interface ArtifactLookupHit {
  size: number;
  taskDurationMs: number;
  tag?: string;
}

export type ArtifactLookupResponse = Record<string, ArtifactLookupHit | null>;

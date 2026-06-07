export enum AuthScope {
  Read = "read",
  Write = "write",
}

export interface AuthContext {
  allowedTeams: readonly string[];
  scopes: readonly AuthScope[];
  tokenId: string;
}

export interface D1TokenRow {
  expires_at?: string | null;
  id: string;
  revoked_at?: string | null;
  scopes: string;
  teams: string;
}

export interface StaticTokenRule {
  id?: string;
  scopes: readonly AuthScope[];
  teams: readonly string[];
  token: string;
}

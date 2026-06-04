export enum AuthScope {
	Read = "read",
	Write = "write",
}

export interface AuthContext {
	scopes: readonly AuthScope[];
	tokenId: string;
}

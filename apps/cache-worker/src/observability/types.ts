export enum MetricEvent {
	Events = "events",
	GetHit = "get_hit",
	GetMiss = "get_miss",
	HeadHit = "head_hit",
	HeadMiss = "head_miss",
	Preflight = "preflight",
	Put = "put",
	SignatureMissing = "signature_missing",
	Status = "status",
}

export interface MetricPoint {
	artifactId?: string;
	bytes?: number;
	event: MetricEvent;
	method: string;
	status: number;
	tenant?: string;
	tokenId?: string;
}

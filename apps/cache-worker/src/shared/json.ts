export function parseJsonArray(value: string): unknown[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function unique<T>(values: readonly T[]): readonly T[] {
	return [...new Set(values)];
}

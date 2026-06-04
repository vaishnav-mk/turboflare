export async function mapWithConcurrency<T, U>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<U>): Promise<U[]> {
	const results = new Array<U>(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]);
		}
	}

	const workerCount = Math.min(concurrency, items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

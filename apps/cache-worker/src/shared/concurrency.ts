export async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results = Array.from<U>({ length: items.length });
  const batchSize = Math.max(1, concurrency);

  for (let batchStart = 0; batchStart < items.length; batchStart += batchSize) {
    const batch = items.slice(batchStart, batchStart + batchSize);
    const batchResults = await Promise.all(batch.map((item) => mapper(item)));
    for (const [batchIndex, result] of batchResults.entries()) {
      results[batchStart + batchIndex] = result;
    }
  }

  return results;
}

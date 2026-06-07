export function numberHeader(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : undefined;
}

export function parseDurationMs(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  const duration = Number.parseInt(value, 10);
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

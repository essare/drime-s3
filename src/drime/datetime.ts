/** Normalize Drime/Laravel ISO timestamps (e.g. six-digit fractional seconds) for parsing. */
export function normalizeDrimeIso(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return trimmed;
  const [, base, fraction, zone] = match;
  if (!fraction) return `${base}${zone}`;
  const ms = fraction.slice(1, 4).padEnd(3, "0");
  return `${base}.${ms}${zone}`;
}

/** Convert a Drime timestamp to canonical ISO, or null when missing/invalid. */
export function drimeTimestampToIso(
  updatedAt: string | null | undefined,
  createdAt?: string | null | undefined,
): string | null {
  for (const candidate of [updatedAt, createdAt]) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      continue;
    }
    const t = Date.parse(normalizeDrimeIso(candidate));
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

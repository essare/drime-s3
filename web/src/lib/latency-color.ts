export function latencyColorClass(ms: number): string {
  if (ms < 500) return "text-emerald-500";
  if (ms <= 1500) return "text-amber-500";
  return "text-red-500";
}

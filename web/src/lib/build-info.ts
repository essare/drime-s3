/** Injected at build time via Vite (`vite.config.ts`). */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION;
export const COMMIT_SHA = import.meta.env.VITE_COMMIT_SHA;

export function formatBuildLabel(
  version: string = APP_VERSION,
  commit: string = COMMIT_SHA,
): string {
  const v = version.startsWith("v") ? version : `v${version}`;
  return `${v} (${commit})`;
}

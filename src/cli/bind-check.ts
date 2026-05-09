import type { AppConfig } from "../config";
import { ConfigError } from "../config";

/**
 * Design §6.3: refuse insecure mode when binding to a non-loopback address unless explicitly overridden.
 */
export function assertSafeInsecureBind(
  cfg: AppConfig,
  allowPublicInsecure: boolean,
): void {
  if (!cfg.insecure || allowPublicInsecure) {
    return;
  }
  const h = cfg.server.host.trim().toLowerCase();
  const loopback =
    h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  if (!loopback) {
    throw new ConfigError(
      `Refusing insecure mode with host ${JSON.stringify(cfg.server.host)}: bind to 127.0.0.1 (or localhost / ::1), or pass --i-know-what-im-doing.`,
    );
  }
}

export type CliGlobalFlags = {
  configPath?: string;
  insecureCli: boolean;
  iKnowWhatImDoing: boolean;
  host?: string;
  port?: number;
};

/**
 * Strips global flags from argv (after `bun … main.ts`).
 */
export function parseGlobalFlags(argv: string[]): {
  flags: CliGlobalFlags;
  positional: string[];
} {
  const flags: CliGlobalFlags = {
    insecureCli: false,
    iKnowWhatImDoing: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--config") {
      const v = argv[i + 1];
      if (typeof v === "string") {
        flags.configPath = v;
        i++;
      }
      continue;
    }
    if (a === "--insecure") {
      flags.insecureCli = true;
      continue;
    }
    if (a === "--i-know-what-im-doing") {
      flags.iKnowWhatImDoing = true;
      continue;
    }
    if (a === "--host") {
      const v = argv[i + 1];
      if (typeof v === "string") {
        flags.host = v;
        i++;
      }
      continue;
    }
    if (a === "--port") {
      const v = argv[i + 1];
      if (typeof v === "string") {
        const n = Number.parseInt(v, 10);
        if (Number.isFinite(n)) flags.port = n;
        i++;
      }
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

export function applyCliOverridesToConfig<
  T extends {
    insecure: boolean;
    server: { host: string; port: number };
  },
>(cfg: T, flags: CliGlobalFlags): void {
  if (flags.insecureCli) {
    cfg.insecure = true;
  }
  if (flags.host !== undefined && flags.host.trim() !== "") {
    cfg.server.host = flags.host.trim();
  }
  if (flags.port !== undefined && flags.port > 0 && flags.port <= 65535) {
    cfg.server.port = flags.port;
  }
}

import { homedir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";

/** Thrown when configuration is invalid (e.g. missing S3 credentials in secure mode). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type S3AuthConfig = {
  accessKey: string;
  secretKey: string;
  region: string;
};

export type DrimeConfig = {
  apiKey: string;
  apiBaseUrl: string;
  /** Drime workspace whose root folders map to S3 buckets (default `drime-s3`). */
  gatewayWorkspaceName: string;
  /** If set, skip `GET /me/workspaces` discovery and use this id. */
  gatewayWorkspaceId?: number;
};

export type ServerConfig = {
  host: string;
  port: number;
};

export type AppConfig = {
  s3: S3AuthConfig;
  drime: DrimeConfig;
  server: ServerConfig;
  insecure: boolean;
};

const DEFAULT_DRIME_API_BASE = "https://app.drime.cloud/api/v1";

type TomlRoot = {
  s3?: Record<string, unknown>;
  drime?: Record<string, unknown>;
  server?: Record<string, unknown>;
};

function defaultConfig(): AppConfig {
  return {
    s3: {
      accessKey: "",
      secretKey: "",
      region: "drime",
    },
    drime: {
      apiKey: "",
      apiBaseUrl: DEFAULT_DRIME_API_BASE,
      gatewayWorkspaceName: "drime-s3",
      gatewayWorkspaceId: undefined,
    },
    server: {
      host: "127.0.0.1",
      port: 8081,
    },
    insecure: false,
  };
}

function pickNonEmptyString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

function parseInsecureEnv(): boolean {
  const raw = process.env.DRIME_S3_INSECURE;
  if (raw === undefined) return false;
  const t = raw.trim().toLowerCase();
  return t === "1" || t === "true";
}

function readTomlRoot(text: string): TomlRoot {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const v = parse(trimmed) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as TomlRoot;
    return {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`Invalid TOML: ${msg}`);
  }
}

function applyToml(cfg: AppConfig, root: TomlRoot): void {
  const s3 = root.s3;
  if (s3) {
    const access =
      pickNonEmptyString(s3.access_key) ?? pickNonEmptyString(s3.accessKey);
    const secret =
      pickNonEmptyString(s3.secret_key) ?? pickNonEmptyString(s3.secretKey);
    const region = pickNonEmptyString(s3.region);
    if (access !== undefined) cfg.s3.accessKey = access;
    if (secret !== undefined) cfg.s3.secretKey = secret;
    if (region !== undefined) cfg.s3.region = region;
  }
  const drime = root.drime;
  if (drime) {
    const apiKey = pickNonEmptyString(drime.api_key);
    const apiBaseUrl = pickNonEmptyString(drime.api_base_url);
    const gatewayName =
      pickNonEmptyString(drime.gateway_workspace_name) ??
      pickNonEmptyString(drime.gatewayWorkspaceName);
    const gatewayIdRaw = drime.gateway_workspace_id ?? drime.gatewayWorkspaceId;
    if (apiKey !== undefined) cfg.drime.apiKey = apiKey;
    if (apiBaseUrl !== undefined) cfg.drime.apiBaseUrl = apiBaseUrl;
    if (gatewayName !== undefined) cfg.drime.gatewayWorkspaceName = gatewayName;
    if (gatewayIdRaw !== undefined) {
      const n =
        typeof gatewayIdRaw === "number"
          ? gatewayIdRaw
          : Number.parseInt(String(gatewayIdRaw), 10);
      if (Number.isInteger(n) && n > 0) cfg.drime.gatewayWorkspaceId = n;
    }
  }
  const server = root.server;
  if (server) {
    const host = pickNonEmptyString(server.host);
    const port = server.port;
    if (host !== undefined) cfg.server.host = host;
    if (typeof port === "number" && Number.isInteger(port) && port > 0) {
      cfg.server.port = port;
    }
  }
}

function applyEnv(cfg: AppConfig): void {
  const apiBase = pickNonEmptyString(process.env.DRIME_API_BASE_URL);
  if (apiBase !== undefined) cfg.drime.apiBaseUrl = apiBase;

  const apiKey =
    pickNonEmptyString(process.env.DRIME_API_KEY) ??
    pickNonEmptyString(process.env.API_KEY);
  if (apiKey !== undefined) cfg.drime.apiKey = apiKey;

  const access = pickNonEmptyString(process.env.S3_ACCESS_KEY);
  if (access !== undefined) cfg.s3.accessKey = access;
  const secret = pickNonEmptyString(process.env.S3_SECRET_KEY);
  if (secret !== undefined) cfg.s3.secretKey = secret;

  const gwName = pickNonEmptyString(process.env.DRIME_GATEWAY_WORKSPACE_NAME);
  if (gwName !== undefined) cfg.drime.gatewayWorkspaceName = gwName;

  const gwIdRaw = process.env.DRIME_GATEWAY_WORKSPACE_ID;
  if (gwIdRaw !== undefined && gwIdRaw.trim() !== "") {
    const n = Number.parseInt(gwIdRaw.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ConfigError(
        `Invalid DRIME_GATEWAY_WORKSPACE_ID: expected positive integer, got ${JSON.stringify(gwIdRaw)}`,
      );
    }
    cfg.drime.gatewayWorkspaceId = n;
  }

  const host = pickNonEmptyString(process.env.DRIME_S3_HOST);
  if (host !== undefined) cfg.server.host = host;

  const portRaw = process.env.DRIME_S3_PORT;
  if (portRaw !== undefined && portRaw.trim() !== "") {
    const n = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) {
      throw new ConfigError(
        `Invalid DRIME_S3_PORT: expected integer 1–65535, got ${JSON.stringify(portRaw)}`,
      );
    }
    cfg.server.port = n;
  }

  cfg.insecure = parseInsecureEnv();
}

/** DRIMES3 + random alphanumeric so total length is 20 (spec-style dev access key). */
function generateAccessKey(): string {
  const prefix = "DRIMES3";
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const need = Math.max(0, 20 - prefix.length);
  const bytes = new Uint8Array(need);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (let i = 0; i < need; i++) {
    const b = bytes[i];
    if (b === undefined) break;
    suffix += alphabet.charAt(b % alphabet.length);
  }
  return `${prefix}${suffix}`;
}

/** 40 random bytes as base64url (URL-safe, no padding). */
function generateSecretKey(): string {
  const buf = new Uint8Array(40);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}

function ensureS3Keys(cfg: AppConfig): void {
  const missingAccess = !cfg.s3.accessKey;
  const missingSecret = !cfg.s3.secretKey;
  if (!missingAccess && !missingSecret) return;

  if (cfg.insecure) {
    // In insecure (dev) mode, ephemeral credentials are fine so callers/tests are not blocked.
    if (missingAccess) cfg.s3.accessKey = generateAccessKey();
    if (missingSecret) cfg.s3.secretKey = generateSecretKey();
    return;
  }

  if (missingAccess || missingSecret) {
    throw new ConfigError(
      "S3 credentials missing: set [s3] access_key and secret_key in config, or S3_ACCESS_KEY and S3_SECRET_KEY in the environment. In local dev you may set DRIME_S3_INSECURE=1 to generate ephemeral keys.",
    );
  }
}

export function resolveConfigPath(configPath?: string): string {
  if (configPath !== undefined && configPath !== "") {
    if (configPath.startsWith("~/")) {
      return path.join(homedir(), configPath.slice(2));
    }
    return configPath;
  }
  return path.join(homedir(), ".config", "drime-s3", "config.toml");
}

async function readConfigTomlText(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return "";
  return file.text();
}

export async function loadConfig(opts?: {
  configPath?: string;
}): Promise<AppConfig> {
  const cfg = defaultConfig();
  const resolvedPath = resolveConfigPath(opts?.configPath);
  const tomlText = await readConfigTomlText(resolvedPath);
  applyToml(cfg, readTomlRoot(tomlText));
  applyEnv(cfg);
  ensureS3Keys(cfg);
  return cfg;
}

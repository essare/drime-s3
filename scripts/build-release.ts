import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function shortSha(raw: string): string {
  const s = raw.trim();
  if (s.length === 0) return "dev";
  return s.length > 7 ? s.slice(0, 7) : s;
}

function resolveCommitSha(): string {
  const fromEnv =
    process.env.COMMIT_SHA?.trim() || process.env.VITE_COMMIT_SHA?.trim();
  if (fromEnv) return shortSha(fromEnv);
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
}

function resolveAppVersion(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function run(
  cmd: string,
  args: string[],
  env?: Record<string, string | undefined>,
): void {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const buildEnv = {
  VITE_APP_VERSION: resolveAppVersion(),
  VITE_COMMIT_SHA: resolveCommitSha(),
};

run("bun", ["run", "web:build"], buildEnv);
run("bun", [
  "build",
  "src/cli/main.ts",
  "--compile",
  "--outfile=dist/main",
  "--target=bun",
]);

const srcDist = path.join(repoRoot, "web", "dist");
const dstDist = path.join(repoRoot, "dist", "web", "dist");

if (!existsSync(srcDist)) {
  console.error("Expected web/dist after web:build");
  process.exit(1);
}

mkdirSync(path.dirname(dstDist), { recursive: true });
rmSync(dstDist, { recursive: true, force: true });
cpSync(srcDist, dstDist, { recursive: true });

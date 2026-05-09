import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("bun", ["run", "web:build"]);
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

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __test__dispatchUiAssetsAt,
  __test__safeNormalizePath,
} from "../../src/admin/ui-assets";
import type { AppContext } from "../../src/server-context";

const mockCtx = {} as AppContext;

describe("admin/ui-assets", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "drime-ui-assets-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("POST /_ui/index.html returns 405 with Allow: GET, HEAD", async () => {
    writeFileSync(path.join(tmpRoot, "index.html"), "<html>x</html>");
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/index.html", { method: "POST" }),
      new URL("http://127.0.0.1:8081/_ui/index.html"),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
  });

  test("/_ui/ serves index.html with no-cache", async () => {
    writeFileSync(path.join(tmpRoot, "index.html"), "<html>FAKE</html>");
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/", {
        headers: { Host: "127.0.0.1:8081" },
      }),
      new URL("http://127.0.0.1:8081/_ui/"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toBe("<html>FAKE</html>");
  });

  test("/_ui (no trailing slash) serves index.html", async () => {
    writeFileSync(path.join(tmpRoot, "index.html"), "<html>FAKE</html>");
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui", {
        headers: { Host: "127.0.0.1:8081" },
      }),
      new URL("http://127.0.0.1:8081/_ui"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>FAKE</html>");
  });

  test("HEAD returns Content-Length and empty body", async () => {
    writeFileSync(path.join(tmpRoot, "index.html"), "<html>FAKE</html>");
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/", { method: "HEAD" }),
      new URL("http://127.0.0.1:8081/_ui/"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe(
      String(Buffer.byteLength("<html>FAKE</html>", "utf8")),
    );
    expect(await res.text()).toBe("");
  });

  test("hashed asset under /assets gets immutable cache", async () => {
    mkdirSync(path.join(tmpRoot, "assets"));
    writeFileSync(
      path.join(tmpRoot, "assets", "index-abc123.js"),
      "console.log(1)",
    );
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/assets/index-abc123.js"),
      new URL("http://127.0.0.1:8081/_ui/assets/index-abc123.js"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await res.text()).toBe("console.log(1)");
  });

  test("SPA fallback: /_ui/dashboard + Accept text/html serves index.html", async () => {
    writeFileSync(path.join(tmpRoot, "index.html"), "<html>SPA</html>");
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/dashboard", {
        headers: { Accept: "text/html" },
      }),
      new URL("http://127.0.0.1:8081/_ui/dashboard"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>SPA</html>");
  });

  test("missing .js returns 404 (no SPA fallback for asset extensions)", async () => {
    writeFileSync(path.join(tmpRoot, "index.html"), "<html>SPA</html>");
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/missing.js", {
        headers: { Accept: "text/html" },
      }),
      new URL("http://127.0.0.1:8081/_ui/missing.js"),
    );
    expect(res.status).toBe(404);
  });

  test("path traversal segments rejected (normalizer)", () => {
    expect(__test__safeNormalizePath("/_ui/../package.json")).toBeNull();
    expect(__test__safeNormalizePath("/_ui/%2e%2e/package.json")).toBeNull();
  });

  test("non-existent root returns 404 for /_ui/", async () => {
    const missing = path.join(tmpRoot, "nope");
    const res = await __test__dispatchUiAssetsAt(
      missing,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/"),
      new URL("http://127.0.0.1:8081/_ui/"),
    );
    expect(res.status).toBe(404);
    expect(existsSync(missing)).toBe(false);
  });

  test("backslashes rejected", async () => {
    writeFileSync(path.join(tmpRoot, "index.html"), "ok");
    const res = await __test__dispatchUiAssetsAt(
      tmpRoot,
      mockCtx,
      new Request("http://127.0.0.1:8081/_ui/foo%5Cbar"),
      new URL("http://127.0.0.1:8081/_ui/foo%5Cbar"),
    );
    expect(res.status).toBe(400);
  });
});

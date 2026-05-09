import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  beforeEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
    delete process.env.DRIME_GATEWAY_WORKSPACE_NAME;
    delete process.env.DRIME_GATEWAY_WORKSPACE_ID;
    delete process.env.DRIME_API_BASE_URL;
    delete process.env.WEB_UI_PASSWORD;
    delete process.env.WEB_UI_SESSION_SECRET;
  });
  afterEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
    delete process.env.DRIME_GATEWAY_WORKSPACE_NAME;
    delete process.env.DRIME_GATEWAY_WORKSPACE_ID;
    delete process.env.DRIME_API_BASE_URL;
    delete process.env.WEB_UI_PASSWORD;
    delete process.env.WEB_UI_SESSION_SECRET;
  });

  test("env overrides file for api key", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.DRIME_API_KEY = "env-key";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.apiKey).toBe("env-key");
  });

  test("DRIME_API_KEY wins over API_KEY", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.API_KEY = "api-key-fallback";
    process.env.DRIME_API_KEY = "primary";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.apiKey).toBe("primary");
  });

  test("API_KEY used when DRIME_API_KEY unset", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.API_KEY = "from-api-key-env";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.apiKey).toBe("from-api-key-env");
  });

  test("DRIME_API_BASE_URL override", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.DRIME_API_BASE_URL = "https://example.test/api/v1";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.apiBaseUrl).toBe("https://example.test/api/v1");
  });

  test("default gateway workspace name is drime-s3", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.gatewayWorkspaceName).toBe("drime-s3");
    expect(c.drime.gatewayWorkspaceId).toBeUndefined();
  });

  test("DRIME_GATEWAY_WORKSPACE_NAME override", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.DRIME_GATEWAY_WORKSPACE_NAME = "my-s3-space";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.gatewayWorkspaceName).toBe("my-s3-space");
  });

  test("DRIME_GATEWAY_WORKSPACE_ID pin", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.DRIME_GATEWAY_WORKSPACE_ID = "42";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.gatewayWorkspaceId).toBe(42);
  });

  test("invalid DRIME_GATEWAY_WORKSPACE_ID throws", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.DRIME_GATEWAY_WORKSPACE_ID = "0";
    await expect(
      loadConfig({ configPath: "/nonexistent.toml" }),
    ).rejects.toThrow(/DRIME_GATEWAY_WORKSPACE_ID/);
  });

  test("loadConfig reads WEB_UI_PASSWORD and WEB_UI_SESSION_SECRET from env", async () => {
    const prev = {
      pwd: process.env.WEB_UI_PASSWORD,
      sec: process.env.WEB_UI_SESSION_SECRET,
      insecure: process.env.DRIME_S3_INSECURE,
    };
    process.env.WEB_UI_PASSWORD = "hunter2-hunter2";
    process.env.WEB_UI_SESSION_SECRET = "deadbeef".repeat(8); // 64 hex
    process.env.DRIME_S3_INSECURE = "1";
    try {
      const cfg = await loadConfig({ configPath: "/nonexistent.toml" });
      expect(cfg.webUi.password).toBe("hunter2-hunter2");
      expect(cfg.webUi.sessionSecret).toBe("deadbeef".repeat(8));
    } finally {
      process.env.WEB_UI_PASSWORD = prev.pwd;
      process.env.WEB_UI_SESSION_SECRET = prev.sec;
      process.env.DRIME_S3_INSECURE = prev.insecure;
    }
  });

  test("loadConfig leaves webUi fields empty when env unset", async () => {
    const prev = {
      pwd: process.env.WEB_UI_PASSWORD,
      sec: process.env.WEB_UI_SESSION_SECRET,
      insecure: process.env.DRIME_S3_INSECURE,
    };
    delete process.env.WEB_UI_PASSWORD;
    delete process.env.WEB_UI_SESSION_SECRET;
    process.env.DRIME_S3_INSECURE = "1";
    try {
      const cfg = await loadConfig({ configPath: "/nonexistent.toml" });
      expect(cfg.webUi.password).toBe("");
      expect(cfg.webUi.sessionSecret).toBe("");
    } finally {
      process.env.WEB_UI_PASSWORD = prev.pwd;
      process.env.WEB_UI_SESSION_SECRET = prev.sec;
      process.env.DRIME_S3_INSECURE = prev.insecure;
    }
  });

  test("loadConfig throws on invalid WEB_UI_SESSION_SECRET (too short)", async () => {
    const prev = {
      sec: process.env.WEB_UI_SESSION_SECRET,
      insecure: process.env.DRIME_S3_INSECURE,
    };
    process.env.WEB_UI_SESSION_SECRET = "deadbeef"; // 8 chars, valid hex but too short
    process.env.DRIME_S3_INSECURE = "1";
    try {
      await expect(
        loadConfig({ configPath: "/nonexistent.toml" }),
      ).rejects.toThrow(/WEB_UI_SESSION_SECRET/);
    } finally {
      process.env.WEB_UI_SESSION_SECRET = prev.sec;
      process.env.DRIME_S3_INSECURE = prev.insecure;
    }
  });

  test("loadConfig throws on non-hex WEB_UI_SESSION_SECRET", async () => {
    const prev = {
      sec: process.env.WEB_UI_SESSION_SECRET,
      insecure: process.env.DRIME_S3_INSECURE,
    };
    process.env.WEB_UI_SESSION_SECRET = "z".repeat(64); // 64 chars but not hex
    process.env.DRIME_S3_INSECURE = "1";
    try {
      await expect(
        loadConfig({ configPath: "/nonexistent.toml" }),
      ).rejects.toThrow(/WEB_UI_SESSION_SECRET/);
    } finally {
      process.env.WEB_UI_SESSION_SECRET = prev.sec;
      process.env.DRIME_S3_INSECURE = prev.insecure;
    }
  });

  test("loadConfig normalizes uppercase WEB_UI_SESSION_SECRET to lowercase", async () => {
    const prev = {
      sec: process.env.WEB_UI_SESSION_SECRET,
      insecure: process.env.DRIME_S3_INSECURE,
    };
    process.env.WEB_UI_SESSION_SECRET = "DEADBEEF".repeat(8);
    process.env.DRIME_S3_INSECURE = "1";
    try {
      const cfg = await loadConfig({ configPath: "/nonexistent.toml" });
      expect(cfg.webUi.sessionSecret).toBe("deadbeef".repeat(8));
    } finally {
      process.env.WEB_UI_SESSION_SECRET = prev.sec;
      process.env.DRIME_S3_INSECURE = prev.insecure;
    }
  });

  test("loadConfig reads [web_ui] block from TOML and validates session_secret", async () => {
    const prev = {
      pwd: process.env.WEB_UI_PASSWORD,
      sec: process.env.WEB_UI_SESSION_SECRET,
      insecure: process.env.DRIME_S3_INSECURE,
    };
    delete process.env.WEB_UI_PASSWORD;
    delete process.env.WEB_UI_SESSION_SECRET;
    process.env.DRIME_S3_INSECURE = "1";

    const tmpDir = await Bun.file(
      `${process.env.TMPDIR ?? "/tmp"}/.placeholder`,
    )
      .exists()
      .then(() => process.env.TMPDIR ?? "/tmp");
    const goodPath = `${tmpDir}/drime-s3-config-good-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`;
    const badPath = `${tmpDir}/drime-s3-config-bad-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`;

    try {
      await Bun.write(
        goodPath,
        `[web_ui]\npassword = "from-toml"\nsession_secret = "${"CAFEBABE".repeat(8)}"\n`,
      );
      const ok = await loadConfig({ configPath: goodPath });
      expect(ok.webUi.password).toBe("from-toml");
      expect(ok.webUi.sessionSecret).toBe("cafebabe".repeat(8));

      await Bun.write(badPath, `[web_ui]\nsession_secret = "tooShort"\n`);
      await expect(loadConfig({ configPath: badPath })).rejects.toThrow(
        /WEB_UI_SESSION_SECRET/,
      );
    } finally {
      await unlink(goodPath).catch(() => undefined);
      await unlink(badPath).catch(() => undefined);
      process.env.WEB_UI_PASSWORD = prev.pwd;
      process.env.WEB_UI_SESSION_SECRET = prev.sec;
      process.env.DRIME_S3_INSECURE = prev.insecure;
    }
  });
});

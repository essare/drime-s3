import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  beforeEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
    delete process.env.DRIME_GATEWAY_WORKSPACE_NAME;
    delete process.env.DRIME_GATEWAY_WORKSPACE_ID;
  });
  afterEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
    delete process.env.DRIME_GATEWAY_WORKSPACE_NAME;
    delete process.env.DRIME_GATEWAY_WORKSPACE_ID;
  });

  test("env overrides file for api key", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.DRIME_API_KEY = "env-key";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.apiKey).toBe("env-key");
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
});

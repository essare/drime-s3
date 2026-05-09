import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config";

describe("loadConfig", () => {
  beforeEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
  });
  afterEach(() => {
    delete process.env.DRIME_API_KEY;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    delete process.env.DRIME_S3_INSECURE;
  });

  test("env overrides file for api key", async () => {
    process.env.DRIME_S3_INSECURE = "1";
    process.env.DRIME_API_KEY = "env-key";
    const c = await loadConfig({ configPath: "/nonexistent.toml" });
    expect(c.drime.apiKey).toBe("env-key");
  });
});

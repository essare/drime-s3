import { describe, expect, test } from "bun:test";
import { assertSafeInsecureBind } from "../../../src/cli/bind-check";
import { type AppConfig, ConfigError } from "../../../src/config";

function sample(over: {
  insecure?: boolean;
  serverHost?: string;
  serverPort?: number;
}): AppConfig {
  return {
    s3: { accessKey: "a", secretKey: "b", region: "r" },
    drime: {
      apiKey: "k",
      apiBaseUrl: "https://example/api/v1",
      gatewayWorkspaceName: "drime-s3",
    },
    server: {
      host: over.serverHost ?? "127.0.0.1",
      port: over.serverPort ?? 8081,
    },
    webUi: { password: "", sessionSecret: "" },
    insecure: over.insecure ?? true,
  };
}

describe("assertSafeInsecureBind", () => {
  test("allows loopback hosts", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      expect(() =>
        assertSafeInsecureBind(sample({ serverHost: host }), false),
      ).not.toThrow();
    }
  });

  test("rejects non-loopback without override", () => {
    expect(() =>
      assertSafeInsecureBind(sample({ serverHost: "0.0.0.0" }), false),
    ).toThrow(ConfigError);
  });

  test("allows non-loopback with override flag", () => {
    expect(() =>
      assertSafeInsecureBind(sample({ serverHost: "0.0.0.0" }), true),
    ).not.toThrow();
  });

  test("no-op when not insecure", () => {
    expect(() =>
      assertSafeInsecureBind(
        sample({ insecure: false, serverHost: "0.0.0.0" }),
        false,
      ),
    ).not.toThrow();
  });
});

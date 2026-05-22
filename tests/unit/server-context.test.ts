import { afterEach, describe, expect, test } from "bun:test";

import { createAppContext } from "../../src/server-context";
import { adminTestConfig } from "../admin/helpers";

describe("createAppContext", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test(
    "starts with null workspace when Drime is unreachable at bootstrap",
    async () => {
      const cfg = adminTestConfig("http://127.0.0.1:9");
      const ctx = await createAppContext({
        config: cfg,
        fetchFn: () => Promise.reject(new TypeError("Unable to connect")),
      });
      expect(ctx.gatewayWorkspaceId).toBeNull();
    },
    { timeout: 15_000 },
  );
});

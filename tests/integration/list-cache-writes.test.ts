import { describe, expect, test } from "bun:test";
import pino from "pino";
import type { AppConfig } from "../../src/config";
import { dispatch } from "../../src/s3/router";
import { createAppContext } from "../../src/server-context";
import { startMockDrime } from "../fixtures/mock-drime/server";

function testConfig(apiBaseUrl: string): AppConfig {
  return {
    s3: {
      accessKey: "AKIATEST",
      secretKey: "test-secret-test-secret-test-secret",
      region: "drime",
    },
    drime: {
      apiKey: "mock-drime-key",
      apiBaseUrl,
      gatewayWorkspaceName: "drime-s3",
    },
    server: { host: "127.0.0.1", port: 8081 },
    webUi: { password: "", sessionSecret: "" },
    insecure: true,
  };
}

const base = "http://127.0.0.1:8081";
const h = { Host: "127.0.0.1:8081" };

describe("list cache stays warm across writes", () => {
  test("PUT, overwrite and DELETE do not force a full re-list", async () => {
    const mock = await startMockDrime();
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      let listCalls = 0;
      const realList = ctx.drime.listFolder.bind(ctx.drime);
      ctx.drime.listFolder = (...args) => {
        listCalls += 1;
        return realList(...args);
      };

      const call = (method: string, path: string, body?: string) =>
        dispatch(
          ctx,
          new Request(`${base}/warm-bucket${path}`, {
            method,
            headers: {
              ...h,
              ...(body !== undefined
                ? { "Content-Length": String(Buffer.byteLength(body)) }
                : {}),
            },
            body,
          }),
        );
      const keys = async () => {
        const res = await call("GET", "/?list-type=2");
        expect(res.status).toBe(200);
        return [...(await res.text()).matchAll(/<Key>([^<]*)<\/Key>/g)].map(
          (m) => m[1],
        );
      };

      expect((await call("PUT", "")).status).toBe(200);
      expect((await call("PUT", "/a.txt", "aaa")).status).toBe(200);
      expect(await keys()).toEqual(["a.txt"]);

      // Cache is warm now; further writes must not trigger another listing.
      const before = listCalls;
      const putB = await call("PUT", "/b.txt", "hello");
      expect(putB.status).toBe(200);
      expect(await keys()).toEqual(["a.txt", "b.txt"]);

      const headB = await call("HEAD", "/b.txt");
      expect(headB.status).toBe(200);
      expect(headB.headers.get("etag")).toBe(putB.headers.get("etag"));
      expect(headB.headers.get("content-length")).toBe("5");

      expect((await call("PUT", "/b.txt", "hello world")).status).toBe(200);
      expect(await keys()).toEqual(["a.txt", "b.txt"]);
      const headB2 = await call("HEAD", "/b.txt");
      expect(headB2.headers.get("content-length")).toBe("11");

      expect((await call("DELETE", "/a.txt")).status).toBe(204);
      expect(await keys()).toEqual(["b.txt"]);
      expect((await call("HEAD", "/a.txt")).status).toBe(404);

      expect(listCalls).toBe(before);
    } finally {
      mock.stop();
    }
  });
});

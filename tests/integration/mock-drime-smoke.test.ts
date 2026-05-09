import { describe, expect, test } from "bun:test";
import { startMockDrime } from "../fixtures/mock-drime/server";

describe("mock Drime server", () => {
  test("serves GET /me/workspaces", async () => {
    const { baseUrl, stop } = await startMockDrime();
    try {
      const res = await fetch(`${baseUrl}/me/workspaces`);
      expect(res.ok).toBe(true);
      const data = (await res.json()) as unknown[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    } finally {
      stop();
    }
  });
});

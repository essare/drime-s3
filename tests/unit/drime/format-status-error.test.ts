import { describe, expect, test } from "bun:test";

import { formatDrimeStatusError } from "../../../src/drime/format-status-error";

describe("formatDrimeStatusError", () => {
  test("rewrites Bun unable-to-connect message", () => {
    expect(
      formatDrimeStatusError(
        "Unable to connect. Is the computer able to access the url?",
      ),
    ).toBe(
      "Cannot connect to the Drime API at the configured base URL. Check DRIME_API_BASE_URL and that this host can reach it.",
    );
  });

  test("rewrites connection refused", () => {
    expect(formatDrimeStatusError("ConnectionRefused")).toContain(
      "Cannot connect to the Drime API",
    );
  });

  test("passes through unknown errors unchanged", () => {
    expect(formatDrimeStatusError("Invalid API key")).toBe("Invalid API key");
  });
});

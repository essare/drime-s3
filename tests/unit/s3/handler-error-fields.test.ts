import { describe, expect, test } from "bun:test";
import { DrimeApiError } from "../../../src/drime/client";
import { safeHandlerErrorFields } from "../../../src/s3/handler-error-fields";

const SECRET = "super-secret-token";

describe("safeHandlerErrorFields", () => {
  test("returns only errType and drimeStatus for DrimeApiError", () => {
    const error = new DrimeApiError(
      500,
      JSON.stringify({ error: "forced failure", token: SECRET }),
    );
    expect(safeHandlerErrorFields(error)).toEqual({
      errType: "DrimeApiError",
      drimeStatus: 500,
    });
    expect(JSON.stringify(safeHandlerErrorFields(error))).not.toContain(SECRET);
    expect(JSON.stringify(safeHandlerErrorFields(error))).not.toContain(
      "forced failure",
    );
  });

  test("returns only errType for a generic Error", () => {
    const error = new Error(`truncated: ${SECRET}`);
    expect(safeHandlerErrorFields(error)).toEqual({ errType: "Error" });
    expect(JSON.stringify(safeHandlerErrorFields(error))).not.toContain(SECRET);
  });

  test("does not copy message, stack, cause, or body fields", () => {
    const error = new DrimeApiError(422, `{"token":"${SECRET}"}`);
    const fields = safeHandlerErrorFields(error) as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(["drimeStatus", "errType"]);
    expect(fields.message).toBeUndefined();
    expect(fields.stack).toBeUndefined();
    expect(fields.cause).toBeUndefined();
    expect(fields.body).toBeUndefined();
    expect(fields.err).toBeUndefined();
  });
});

import { describe, expect, test } from "vitest";

import { randomUuid } from "./utils";

describe("randomUuid", () => {
  test("returns RFC4122 v4-shaped string", () => {
    const id = randomUuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

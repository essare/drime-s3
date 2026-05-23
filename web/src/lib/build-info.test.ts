import { describe, expect, it } from "vitest";

import { formatBuildLabel } from "./build-info";

describe("formatBuildLabel", () => {
  it("formats version and short commit", () => {
    expect(formatBuildLabel("1.3.0", "2988a69")).toBe("v1.3.0 (2988a69)");
  });

  it("does not double-prefix v", () => {
    expect(formatBuildLabel("v1.3.0", "abc1234")).toBe("v1.3.0 (abc1234)");
  });
});

import { describe, expect, it } from "vitest";

import { latencyColorClass } from "./latency-color";

describe("latencyColorClass", () => {
  it("returns green below 500ms", () => {
    expect(latencyColorClass(0)).toBe("text-emerald-500");
    expect(latencyColorClass(499)).toBe("text-emerald-500");
  });

  it("returns amber from 500ms through 1500ms", () => {
    expect(latencyColorClass(500)).toBe("text-amber-500");
    expect(latencyColorClass(1500)).toBe("text-amber-500");
  });

  it("returns red above 1500ms", () => {
    expect(latencyColorClass(1501)).toBe("text-red-500");
  });
});

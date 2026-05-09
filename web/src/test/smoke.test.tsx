import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("renders an h1", () => {
    render(<h1>Hello</h1>);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ObjectTable } from "./object-table";

describe("ObjectTable", () => {
  it("renders column headers", () => {
    render(
      <ObjectTable
        rows={[]}
        selected={new Set()}
        onSelectChange={() => {}}
        onNavigatePrefix={() => {}}
        hasMore={false}
        isFetching={false}
        isFetchingNextPage={false}
      />,
    );

    expect(
      screen.getByRole("columnheader", { name: /name/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /size/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /modified/i }),
    ).toBeInTheDocument();
  });

  it("renders skeleton rows while fetching an empty listing", () => {
    render(
      <ObjectTable
        rows={[]}
        selected={new Set()}
        onSelectChange={() => {}}
        onNavigatePrefix={() => {}}
        hasMore={false}
        isFetching
        isFetchingNextPage={false}
      />,
    );

    expect(screen.getAllByRole("row")).toHaveLength(7); // header + 6 skeleton rows
  });
});

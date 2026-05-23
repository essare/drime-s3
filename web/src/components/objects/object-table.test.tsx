import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/utils";

import { ObjectTable } from "./object-table";

const noopDownload = vi.fn();
const noopDelete = vi.fn();

describe("ObjectTable", () => {
  it("renders column headers", () => {
    renderWithProviders(
      <ObjectTable
        bucket="test"
        rows={[]}
        selected={new Set()}
        onSelectChange={() => {}}
        onNavigatePrefix={() => {}}
        onDownload={noopDownload}
        onRequestDelete={noopDelete}
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
    renderWithProviders(
      <ObjectTable
        bucket="test"
        rows={[]}
        selected={new Set()}
        onSelectChange={() => {}}
        onNavigatePrefix={() => {}}
        onDownload={noopDownload}
        onRequestDelete={noopDelete}
        hasMore={false}
        isFetching
        isFetchingNextPage={false}
      />,
    );

    expect(screen.getAllByRole("row")).toHaveLength(7); // header + 6 skeleton rows
  });
});

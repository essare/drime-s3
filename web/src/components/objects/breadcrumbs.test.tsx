import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ObjectsBreadcrumbs } from "./breadcrumbs";

describe("ObjectsBreadcrumbs", () => {
  it("renders only the bucket crumb when prefix is empty", () => {
    const onNavigate = vi.fn();
    render(
      <ObjectsBreadcrumbs
        bucket="my-bucket"
        prefix=""
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText("my-bucket")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nested crumbs and navigates when clicking a middle segment", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <ObjectsBreadcrumbs
        bucket="my-bucket"
        prefix="a/b/c/"
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText("my-bucket")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "my-bucket" }));
    expect(onNavigate).toHaveBeenCalledWith("");

    await user.click(screen.getByRole("button", { name: "a" }));
    expect(onNavigate).toHaveBeenCalledWith("a/");

    await user.click(screen.getByRole("button", { name: "b" }));
    expect(onNavigate).toHaveBeenCalledWith("a/b/");
  });

  it("navigates to bucket root when clicking the bucket name", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <ObjectsBreadcrumbs
        bucket="root-bucket"
        prefix="photos/"
        onNavigate={onNavigate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "root-bucket" }));
    expect(onNavigate).toHaveBeenCalledWith("");
  });
});

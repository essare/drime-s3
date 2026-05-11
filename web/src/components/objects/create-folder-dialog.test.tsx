import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateFolderDialog } from "./create-folder-dialog";

function withProviders(client: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  };
}

describe("CreateFolderDialog", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits a valid name and calls onSuccess with the response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "reports", prefix: "reports/" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        bucket="docs"
        prefix=""
        onSuccess={onSuccess}
      />,
      { wrapper: withProviders(client) },
    );

    await userEvent.type(screen.getByLabelText(/folder name/i), "reports");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        name: "reports",
        prefix: "reports/",
      });
    });
  });

  it("rejects a name containing a slash without calling fetch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={() => {}}
        bucket="docs"
        prefix=""
        onSuccess={() => {}}
      />,
      { wrapper: withProviders(client) },
    );
    await userEvent.type(screen.getByLabelText(/folder name/i), "a/b");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(
      await screen.findByText(/slashes are not allowed/i),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the folder-specific 409 message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "FolderAlreadyExists",
            message:
              'A folder named "reports" already exists at this location.',
            details: { existingKind: "folder" },
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={() => {}}
        bucket="docs"
        prefix=""
        onSuccess={() => {}}
      />,
      { wrapper: withProviders(client) },
    );
    await userEvent.type(screen.getByLabelText(/folder name/i), "reports");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(
      await screen.findByText(/a folder named .* already exists/i),
    ).toBeInTheDocument();
  });

  it("shows the file-specific 409 message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "FolderAlreadyExists",
            message: 'An object named "notes" already exists at this location.',
            details: { existingKind: "file" },
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={() => {}}
        bucket="docs"
        prefix=""
        onSuccess={() => {}}
      />,
      { wrapper: withProviders(client) },
    );
    await userEvent.type(screen.getByLabelText(/folder name/i), "notes");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(
      await screen.findByText(/an object named .* already exists/i),
    ).toBeInTheDocument();
  });
});

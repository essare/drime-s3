import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { bucketsKey } from "@/lib/query-keys";
import { createTestQueryClient, renderWithProviders } from "@/test/utils";
import { CreateBucketDialog } from "./create-bucket-dialog";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CreateBucketDialog", () => {
  it("shows a zod validation message when submitting an empty name", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const user = userEvent.setup();
    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter>
        <CreateBucketDialog open onOpenChange={() => {}} />
      </MemoryRouter>,
      client,
    );

    await user.click(screen.getByRole("button", { name: "Create bucket" }));

    expect(
      await screen.findByText("Must be at least 3 characters"),
    ).toBeInTheDocument();
  });

  it("invalidates buckets and navigates after a successful create", async () => {
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/_admin/buckets" && method === "POST") {
          return jsonResponse({ name: "foo" }, 201);
        }
        throw new Error(`Unexpected ${method} ${path}`);
      },
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={<CreateBucketDialog open onOpenChange={() => {}} />}
          />
          <Route
            path="/buckets/foo"
            element={<div data-testid="bucket-sentinel">bucket-detail-foo</div>}
          />
        </Routes>
      </MemoryRouter>,
      client,
    );

    await user.type(screen.getByLabelText(/bucket name/i), "my-valid-bucket");
    await user.click(screen.getByRole("button", { name: "Create bucket" }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: bucketsKey }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("bucket-sentinel")).toBeInTheDocument();
    });
  });

  it("maps 409 BucketAlreadyExists to a field error without toast", async () => {
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/_admin/buckets" && method === "POST") {
          return jsonResponse(
            {
              error: {
                code: "BucketAlreadyExists",
                message: "Bucket already exists on server",
              },
            },
            409,
          );
        }
        throw new Error(`Unexpected ${method} ${path}`);
      },
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    const client = createTestQueryClient();

    renderWithProviders(
      <MemoryRouter>
        <CreateBucketDialog open onOpenChange={() => {}} />
      </MemoryRouter>,
      client,
    );

    await user.type(screen.getByLabelText(/bucket name/i), "dup-bucket");
    await user.click(screen.getByRole("button", { name: "Create bucket" }));

    expect(
      await screen.findByText("Bucket already exists"),
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("maps 400 InvalidBucketName to the server message on the field", async () => {
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        if (path === "/_admin/buckets" && method === "POST") {
          return jsonResponse(
            {
              error: {
                code: "InvalidBucketName",
                message: "Server rejected this bucket name",
              },
            },
            400,
          );
        }
        throw new Error(`Unexpected ${method} ${path}`);
      },
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    const client = createTestQueryClient();

    renderWithProviders(
      <MemoryRouter>
        <CreateBucketDialog open onOpenChange={() => {}} />
      </MemoryRouter>,
      client,
    );

    await user.type(screen.getByLabelText(/bucket name/i), "valid-name");
    await user.click(screen.getByRole("button", { name: "Create bucket" }));

    expect(
      await screen.findByText("Server rejected this bucket name"),
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

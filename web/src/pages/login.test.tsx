import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, renderWithProviders } from "@/test/utils";
import LoginPage from "./login";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { toast } from "sonner";

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.mocked(toast.error).mockClear();
});

function mockAdminAndLogin(opts: {
  loginStatus?: number;
  loginJson?: unknown;
}): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.href;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/_admin/health")) {
        return new Response(
          JSON.stringify({
            ok: true,
            version: "0.1.0",
            hasPassword: true,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/_admin/session")) {
        return new Response(
          JSON.stringify({
            authenticated: false,
            expiresAt: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/_admin/login") && method === "POST") {
        const status = opts.loginStatus ?? 200;
        const body =
          opts.loginJson ??
          (status === 200
            ? { authenticated: true, expiresInSec: 3600 }
            : { error: { code: "Unauthorized", message: "nope" } });
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("not found", { status: 404 });
    },
  ) as unknown as typeof fetch;
}

function renderLoginRoute() {
  const client = createTestQueryClient();
  const view = renderWithProviders(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={<div data-testid="dashboard-landed">ok</div>}
        />
      </Routes>
    </MemoryRouter>,
    client,
  );
  return { ...view, client };
}

describe("LoginPage", () => {
  it("renders password field and submit", async () => {
    mockAdminAndLogin({});
    renderLoginRoute();

    await waitFor(() => {
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /log in/i })).toBeInTheDocument();
  });

  it("shows zod required message when password is empty", async () => {
    mockAdminAndLogin({});
    renderLoginRoute();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /log in/i })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByText("Required")).toBeInTheDocument();
    });
  });

  it("submits login, invalidates session, and navigates to dashboard", async () => {
    mockAdminAndLogin({});
    const { client } = renderLoginRoute();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^password$/i), "secret");
    await user.click(screen.getByRole("button", { name: /^log in$/i }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["admin", "session"] }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-landed")).toBeInTheDocument();
    });
  });

  it("shows invalid password toast on 401", async () => {
    mockAdminAndLogin({ loginStatus: 401 });
    renderLoginRoute();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^password$/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^log in$/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Invalid password");
    });
  });
});

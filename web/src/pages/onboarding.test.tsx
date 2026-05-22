import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { createTestQueryClient, renderWithProviders } from "@/test/utils";
import OnboardingPage from "./onboarding";

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

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installAdminFetch(handlers: {
  status: () => Response | Promise<Response>;
  initPost?: () => Response | Promise<Response>;
}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    const path = new URL(url, "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();

    if (path === "/_admin/session") {
      return jsonResponse({
        authenticated: true,
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    }
    if (path === "/_admin/status") {
      return handlers.status();
    }
    if (path === "/_admin/init" && method === "POST" && handlers.initPost) {
      return handlers.initPost();
    }
    throw new Error(`Unmocked request: ${method} ${path}`);
  }) as unknown as typeof fetch;
}

describe("OnboardingPage", () => {
  it("focuses on Step 3 (workspace) when env + drime are complete", async () => {
    globalThis.fetch = installAdminFetch({
      status: () =>
        Promise.resolve(
          jsonResponse({
            env: {
              drimeApiKeySet: true,
              drimeApiBaseUrl: "https://drime.example",
              s3KeysSet: true,
              region: "drime",
              webUiPasswordSet: true,
            },
            drime: { reachable: true, latencyMs: 12 },
            workspace: { name: "gw", id: null, exists: false },
          }),
        ),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
      client,
    );

    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Initialize workspace")).toBeInTheDocument();
    expect(screen.getByText("Workspace not found")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /initialize workspace/i }),
    ).toBeInTheDocument();

    expect(screen.queryByText("Environment")).not.toBeInTheDocument();
    expect(screen.queryByText("Drime API")).not.toBeInTheDocument();
  });

  it("focuses on Step 1 (env) when DRIME_API_KEY is missing", async () => {
    globalThis.fetch = installAdminFetch({
      status: () =>
        Promise.resolve(
          jsonResponse({
            env: {
              drimeApiKeySet: false,
              drimeApiBaseUrl: "https://drime.example",
              s3KeysSet: true,
              region: "drime",
              webUiPasswordSet: true,
            },
            drime: { reachable: false, latencyMs: 0 },
            workspace: { name: "gw", id: null, exists: false },
          }),
        ),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
      client,
    );

    expect(await screen.findByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("DRIME_API_KEY is missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /initialize workspace/i }),
    ).not.toBeInTheDocument();
  });

  it("focuses on Step 2 (drime) when env is set but Drime is unreachable", async () => {
    globalThis.fetch = installAdminFetch({
      status: () =>
        Promise.resolve(
          jsonResponse({
            env: {
              drimeApiKeySet: true,
              drimeApiBaseUrl: "https://drime.example",
              s3KeysSet: true,
              region: "drime",
              webUiPasswordSet: true,
            },
            drime: {
              reachable: false,
              latencyMs: 4,
              error: "connection refused",
            },
            workspace: { name: "gw", id: null, exists: false },
          }),
        ),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
      client,
    );

    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Drime API")).toBeInTheDocument();
    expect(screen.getByText("Cannot reach Drime API")).toBeInTheDocument();
    expect(screen.getByText(/connection refused/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /initialize workspace/i }),
    ).not.toBeInTheDocument();
  });

  it("calls POST /_admin/init and shows success toast when Initialize is clicked", async () => {
    const fetchMock = installAdminFetch({
      status: () =>
        Promise.resolve(
          jsonResponse({
            env: {
              drimeApiKeySet: true,
              drimeApiBaseUrl: "https://drime.example",
              s3KeysSet: true,
              region: "drime",
              webUiPasswordSet: true,
            },
            drime: { reachable: true, latencyMs: 87 },
            workspace: { name: "gw", id: null, exists: false },
          }),
        ),
      initPost: () => Promise.resolve(jsonResponse({ workspaceId: 42 })),
    });
    globalThis.fetch = fetchMock;

    const user = userEvent.setup();
    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
      client,
    );

    const btn = await screen.findByRole("button", {
      name: /initialize workspace/i,
    });
    await user.click(btn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Workspace ready");
    });

    const initCalls = (globalThis.fetch as unknown as Mock).mock.calls.filter(
      ([input, init]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.href;
        const path = new URL(url, "http://localhost").pathname;
        return (
          path === "/_admin/init" &&
          (init?.method ?? "GET").toUpperCase() === "POST"
        );
      },
    );
    expect(initCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("disables Retry and shows Retrying while status refetch is in flight", async () => {
    let statusCalls = 0;
    let releasePending: (() => void) | undefined;

    globalThis.fetch = installAdminFetch({
      status: () => {
        statusCalls += 1;
        if (statusCalls === 1) {
          return Promise.resolve(
            jsonResponse({
              env: {
                drimeApiKeySet: true,
                drimeApiBaseUrl: "https://drime.example",
                s3KeysSet: true,
                region: "drime",
                webUiPasswordSet: true,
              },
              drime: {
                reachable: false,
                latencyMs: 4,
                error: "connection refused",
              },
              workspace: { name: "gw", id: null, exists: false },
            }),
          );
        }
        return new Promise<Response>((resolve) => {
          releasePending = () =>
            resolve(
              jsonResponse({
                env: {
                  drimeApiKeySet: true,
                  drimeApiBaseUrl: "https://drime.example",
                  s3KeysSet: true,
                  region: "drime",
                  webUiPasswordSet: true,
                },
                drime: {
                  reachable: false,
                  latencyMs: 4,
                  error: "connection refused",
                },
                workspace: { name: "gw", id: null, exists: false },
              }),
            );
        });
      },
    });

    const user = userEvent.setup();
    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
      client,
    );

    const retry = await screen.findByRole("button", { name: /^retry$/i });
    await user.click(retry);

    expect(
      await screen.findByRole("button", { name: /retrying/i }),
    ).toBeDisabled();

    releasePending?.();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^retry$/i }),
      ).not.toBeDisabled();
    });
  });

  it("Back button navigates to the previous step", async () => {
    globalThis.fetch = installAdminFetch({
      status: () =>
        Promise.resolve(
          jsonResponse({
            env: {
              drimeApiKeySet: true,
              drimeApiBaseUrl: "https://drime.example",
              s3KeysSet: true,
              region: "drime",
              webUiPasswordSet: true,
            },
            drime: { reachable: true, latencyMs: 87 },
            workspace: { name: "gw", id: null, exists: false },
          }),
        ),
    });

    const user = userEvent.setup();
    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>,
      client,
    );

    expect(await screen.findByText("Step 3 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Drime API")).toBeInTheDocument();
  });
});

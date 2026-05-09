import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

type ProvidersProps = {
  client: QueryClient;
  children: ReactNode;
};

function AllProviders({ client, children }: ProvidersProps) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function renderWithProviders(
  ui: ReactElement,
  client?: QueryClient,
  options?: Omit<RenderOptions, "wrapper">,
) {
  const queryClient = client ?? createTestQueryClient();
  return {
    queryClient,
    ...render(ui, {
      wrapper: ({ children }) => (
        <AllProviders client={queryClient}>{children}</AllProviders>
      ),
      ...options,
    }),
  };
}

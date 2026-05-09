import type { z } from "zod";
import { ErrorEnvelopeSchema } from "@/lib/schemas";

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(opts.message);
    this.name = "AdminApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export type AdminRequestInit<T> = Omit<RequestInit, "body"> & {
  schema: z.ZodType<T>;
  body?: unknown;
};

let onUnauthorized: () => void = () => {};

export function registerUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

/** Test-only: reset unauthorized handler to a no-op between tests. */
export function resetUnauthorizedHandler(): void {
  onUnauthorized = () => {};
}

function truncateBody(text: string): string {
  return text.length > 256 ? text.slice(0, 256) : text;
}

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value);
}

function prepareSerializedBody(body: unknown): {
  serialized: RequestInit["body"];
  setJsonContentType: boolean;
} {
  if (body === undefined) {
    return { serialized: undefined, setJsonContentType: false };
  }
  if (typeof body === "string") {
    return { serialized: body, setJsonContentType: false };
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return { serialized: body, setJsonContentType: false };
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return { serialized: body, setJsonContentType: false };
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return { serialized: body, setJsonContentType: false };
  }
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return { serialized: body, setJsonContentType: false };
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return { serialized: body, setJsonContentType: false };
  }
  if (isArrayBufferView(body)) {
    return { serialized: body as BodyInit, setJsonContentType: false };
  }
  if (typeof body === "object" && body !== null) {
    return { serialized: JSON.stringify(body), setJsonContentType: true };
  }
  throw new TypeError("Unsupported request body type");
}

function buildRequestInit(
  init: Omit<RequestInit, "body"> & { body?: unknown },
): RequestInit {
  const { body: rawBody, ...rest } = init;
  const { serialized, setJsonContentType } = prepareSerializedBody(rawBody);
  const headers = new Headers(rest.headers as HeadersInit | undefined);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (typeof window !== "undefined" && !headers.has("Origin")) {
    headers.set("Origin", window.location.origin);
  }
  if (setJsonContentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return {
    ...rest,
    credentials: "include",
    headers,
    body: serialized,
  };
}

async function throwFromErrorResponse(res: Response): Promise<never> {
  const text = await res.text();
  const truncated = truncateBody(text);

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new AdminApiError({
      status: res.status,
      code: "UnknownError",
      message: truncated,
    });
  }

  const envelope = ErrorEnvelopeSchema.safeParse(parsed);
  if (envelope.success) {
    throw new AdminApiError({
      status: res.status,
      code: envelope.data.error.code,
      message: envelope.data.error.message,
      details: envelope.data.error.details,
    });
  }

  throw new AdminApiError({
    status: res.status,
    code: "UnknownError",
    message: truncated,
  });
}

export async function adminFetchJson<T>(
  path: string,
  init: AdminRequestInit<T>,
): Promise<T> {
  const { schema, ...rest } = init;
  const requestInit = buildRequestInit(rest);
  const res = await fetch(path, requestInit);

  if (res.status === 401) {
    onUnauthorized();
  }

  if (!res.ok) {
    await throwFromErrorResponse(res);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new AdminApiError({
      status: res.status,
      code: "InvalidResponse",
      message: `Server returned non-JSON for ${path}`,
    });
  }

  return schema.parse(data);
}

export async function adminFetchEmpty(
  path: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown },
): Promise<void> {
  const requestInit = buildRequestInit(init ?? {});
  const res = await fetch(path, requestInit);

  if (res.status === 401) {
    onUnauthorized();
  }

  if (!res.ok) {
    await throwFromErrorResponse(res);
  }
}

export function joinAdminPath(base: string, ...segments: string[]): string {
  const prefix = base.replace(/\/$/, "");
  const encoded = segments.map((s) => encodeURIComponent(s));
  return [prefix, ...encoded].join("/");
}

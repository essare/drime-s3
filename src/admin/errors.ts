const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
  extraHeaders?: HeadersInit,
): Response {
  const body = {
    error: details ? { code, message, details } : { code, message },
  };
  const h = new Headers(extraHeaders);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function jsonStream(
  body: BodyInit,
  init: {
    status?: number;
    contentType: string;
    contentLength?: number;
    extraHeaders?: HeadersInit;
  },
): Response {
  const h = new Headers(init.extraHeaders);
  h.set("Content-Type", init.contentType);
  h.set("Cache-Control", "no-store");
  if (typeof init.contentLength === "number")
    h.set("Content-Length", String(init.contentLength));
  return new Response(body, { status: init.status ?? 200, headers: h });
}

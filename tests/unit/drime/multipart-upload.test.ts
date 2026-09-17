import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PartRetryOptions,
  retryDelayMs,
  uploadFileViaInternalMultipart,
} from "../../../src/drime/multipart-upload";
import type { AppContext } from "../../../src/server-context";

const SIGNED_URL = "https://storage.example/secret-signed-part-url";

type PutResult = Response | Error;

async function runUpload(
  results: PutResult[],
  retryOverrides: PartRetryOptions = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "drime-s3-part-retry-"));
  const tmpPath = join(dir, "part.bin");
  await writeFile(tmpPath, Buffer.from("replay-safe body"));

  const bodies: BodyInit[] = [];
  const retries: Array<{ fields: Record<string, unknown>; message: string }> =
    [];
  const delays: number[] = [];
  let resultIndex = 0;
  const putUnsignedUrl = mock(
    async (_url: string, init: { body: BodyInit | null }) => {
      if (init.body !== null) bodies.push(init.body);
      const result = results[resultIndex++];
      if (result instanceof Error) throw result;
      if (!result) throw new Error("Missing test PUT result.");
      return result;
    },
  );
  const complete = mock(async () => ({}));
  const abort = mock(async () => ({}));

  const ctx = {
    drime: {
      s3MultipartCreate: mock(async () => ({
        uploadId: "upload-1",
        key: "object-key",
      })),
      s3BatchSignPartUrls: mock(async () => [
        { partNumber: 1, url: SIGNED_URL },
      ]),
      putUnsignedUrl,
      s3MultipartComplete: complete,
      s3CreateEntry: mock(async () => ({ fileEntry: { id: 123 } })),
      s3MultipartAbort: abort,
    },
    logger: {
      warn(fields: Record<string, unknown>, message: string) {
        retries.push({ fields, message });
      },
    },
  } as unknown as AppContext;

  const upload = uploadFileViaInternalMultipart(ctx, {
    tmpPath,
    totalSize: 16,
    filename: "part.bin",
    relativePath: "part.bin",
    extension: "bin",
    parentId: 1,
    workspaceId: 2,
    partSize: 1024,
    retry: {
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
      ...retryOverrides,
    },
  });

  return {
    upload: upload.finally(() => rm(dir, { recursive: true, force: true })),
    putUnsignedUrl,
    complete,
    abort,
    bodies,
    retries,
    delays,
  };
}

function serializeErrorChain(error: unknown): string {
  if (!(error instanceof Error)) return JSON.stringify(error);
  return JSON.stringify({
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: serializeErrorChain(error.cause),
  });
}

function response(status: number, body = ""): Response {
  return new Response(body, {
    status,
    headers: status === 200 ? { etag: '"part-etag"' } : undefined,
  });
}

describe("internal multipart part retries", () => {
  test("retries a transient response with the same buffered body", async () => {
    const retryResponse = response(502, "temporary");
    const run = await runUpload([retryResponse, response(200)]);

    await expect(run.upload).resolves.toMatchObject({
      size: 16,
      entryRaw: { fileEntry: { id: 123 } },
    });
    expect(run.putUnsignedUrl).toHaveBeenCalledTimes(2);
    expect(run.complete).toHaveBeenCalledTimes(1);
    expect(run.bodies[0]).toBe(run.bodies[1]);
    expect(retryResponse.bodyUsed).toBe(true);
    expect(run.retries).toEqual([
      {
        fields: { partNumber: 1, attempt: 1, status: 502 },
        message: "upload_part_retry",
      },
    ]);
    expect(run.delays).toEqual([125]);
  });

  test("retries a thrown network error", async () => {
    const run = await runUpload([
      new TypeError(`socket disconnected from ${SIGNED_URL}`),
      response(200),
    ]);

    await expect(run.upload).resolves.toBeDefined();
    expect(run.putUnsignedUrl).toHaveBeenCalledTimes(2);
    expect(run.complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(run.retries)).not.toContain(SIGNED_URL);
  });

  for (const status of [429, 503, 504]) {
    test(`retries status ${status}`, async () => {
      const run = await runUpload([response(status), response(200)]);

      await expect(run.upload).resolves.toBeDefined();
      expect(run.putUnsignedUrl).toHaveBeenCalledTimes(2);
      expect(run.complete).toHaveBeenCalledTimes(1);
    });
  }

  test("does not retry a non-transient response", async () => {
    const run = await runUpload([response(400, "bad request")]);

    await expect(run.upload).rejects.toThrow("Part 1 upload failed (400)");
    expect(run.putUnsignedUrl).toHaveBeenCalledTimes(1);
    expect(run.complete).not.toHaveBeenCalled();
  });

  test("does not embed upstream response bodies in thrown part errors", async () => {
    const run = await runUpload([response(400, "planted-upstream-body")]);

    let thrown: unknown;
    try {
      await run.upload;
    } catch (error) {
      thrown = error;
    }

    expect(serializeErrorChain(thrown)).not.toContain("planted-upstream-body");
  });

  test("aborts once after five exhausted attempts", async () => {
    const run = await runUpload(Array.from({ length: 5 }, () => response(502)));

    await expect(run.upload).rejects.toThrow(
      "Part 1 upload failed after 5 attempts",
    );
    expect(run.putUnsignedUrl).toHaveBeenCalledTimes(5);
    expect(run.complete).not.toHaveBeenCalled();
    expect(run.abort).toHaveBeenCalledTimes(1);
  });

  test("sanitizes final network exhaustion and clamps attempts to five", async () => {
    const run = await runUpload(
      Array.from(
        { length: 5 },
        (_, attempt) =>
          new Error(`attempt ${attempt + 1} failed for ${SIGNED_URL}`),
      ),
      { maxAttempts: 99 },
    );

    let thrown: unknown;
    try {
      await run.upload;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(run.putUnsignedUrl).toHaveBeenCalledTimes(5);
    expect(run.abort).toHaveBeenCalledTimes(1);
    expect(serializeErrorChain(thrown)).not.toContain(SIGNED_URL);
    expect(JSON.stringify(run.retries)).not.toContain(SIGNED_URL);
  });

  test("uses deterministic exponential delays through the retry path", async () => {
    const run = await runUpload(
      [
        response(502),
        response(502),
        response(502),
        response(502),
        response(200),
      ],
      { random: () => 1 },
    );

    await expect(run.upload).resolves.toBeDefined();
    expect(run.delays).toEqual([250, 500, 1_000, 2_000]);
  });

  test("caps backoff and keeps jitter between fifty and one hundred percent", () => {
    for (const attempt of [1, 2, 3, 4, 5, 20]) {
      const fullDelay = retryDelayMs(attempt, () => 1);
      const halfDelay = retryDelayMs(attempt, () => 0);

      expect(fullDelay).toBeLessThanOrEqual(4_000);
      expect(halfDelay).toBe(Math.floor(fullDelay * 0.5));
    }

    expect(retryDelayMs(5, () => 1)).toBe(4_000);
    expect(retryDelayMs(20, () => 1)).toBe(4_000);
  });
});

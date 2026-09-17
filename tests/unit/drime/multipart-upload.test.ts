import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadFileViaInternalMultipart } from "../../../src/drime/multipart-upload";
import type { AppContext } from "../../../src/server-context";

const SIGNED_URL = "https://storage.example/secret-signed-part-url";

type PutResult = Response | Error;

async function runUpload(results: PutResult[]) {
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
      fileEntryId: 123,
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

    await expect(run.upload).rejects.toThrow(
      "Part 1 upload failed (400): bad request",
    );
    expect(run.putUnsignedUrl).toHaveBeenCalledTimes(1);
    expect(run.complete).not.toHaveBeenCalled();
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
});

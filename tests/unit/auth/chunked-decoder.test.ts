import { describe, expect, test } from "bun:test";
import { createAwsChunkedPayloadTransform } from "../../../src/auth/chunked-decoder";

const ZERO_SIG = `0;chunk-signature=${"0".repeat(64)}`;

function syntheticStream(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

async function collect(rs: ReadableStream<Uint8Array>): Promise<string> {
  const reader = rs.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}

describe("createAwsChunkedPayloadTransform", () => {
  test("decodes hello with terminal chunk (insecure)", async () => {
    const raw =
      `5;chunk-signature=${"0".repeat(64)}\r\n` +
      "hello\r\n" +
      `${ZERO_SIG}\r\n\r\n`;
    const input = syntheticStream(raw);
    const out = input.pipeThrough(
      createAwsChunkedPayloadTransform({ insecure: true }),
    );
    expect(await collect(out)).toBe("hello");
  });

  test("decodes split across small upstream chunks", async () => {
    const raw =
      `3;chunk-signature=${"0".repeat(64)}\r\n` +
      "abc\r\n" +
      `${ZERO_SIG}\r\n\r\n`;
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(raw);
        for (let i = 0; i < bytes.length; i++) {
          controller.enqueue(bytes.subarray(i, i + 1));
        }
        controller.close();
      },
    });
    const out = input.pipeThrough(
      createAwsChunkedPayloadTransform({ insecure: true }),
    );
    expect(await collect(out)).toBe("abc");
  });

  test("decodes optional trailing header lines before blank line", async () => {
    const raw =
      `2;chunk-signature=${"0".repeat(64)}\r\n` +
      "ok\r\n" +
      `${ZERO_SIG}\r\n` +
      "\r\n" +
      "x-amz-checksum-crc32:AAAAAA==\r\n" +
      "\r\n";
    const input = syntheticStream(raw);
    const out = input.pipeThrough(
      createAwsChunkedPayloadTransform({ insecure: true }),
    );
    expect(await collect(out)).toBe("ok");
  });
});

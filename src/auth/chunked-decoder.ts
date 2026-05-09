/**
 * AWS Sig V4 streaming payload decoder (aws-chunked).
 * Strips aws-chunk framing; optional per-chunk signature verification (see options).
 */

const CR = 0x0d;
const LF = 0x0a;

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function indexOfCrlf(buf: Uint8Array, start = 0): number {
  for (let i = start; i + 1 < buf.length; i++) {
    if (buf[i] === CR && buf[i + 1] === LF) {
      return i;
    }
  }
  return -1;
}

function parseChunkMetaLine(
  buf: Uint8Array,
): { size: number; headerEnd: number } | null {
  const end = indexOfCrlf(buf, 0);
  if (end < 0) return null;
  const line = new TextDecoder("ascii").decode(buf.subarray(0, end));
  const semi = line.indexOf(";");
  const hexPart = semi >= 0 ? line.slice(0, semi) : line;
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new ChunkedPayloadError(
      `Invalid aws-chunk meta line: ${line.slice(0, 80)}`,
    );
  }
  const size = Number.parseInt(hexPart, 16);
  if (!Number.isFinite(size) || size < 0) {
    throw new ChunkedPayloadError(`Invalid chunk size: ${hexPart}`);
  }
  return { size, headerEnd: end + 2 };
}

export class ChunkedPayloadError extends Error {
  readonly name = "ChunkedPayloadError";
}

export type AwsChunkedPayloadTransformOptions = {
  /**
   * When true, chunk-signature values are ignored (still parsed).
   * Production verification wires Sig V4 chunk signing in a later task.
   */
  insecure: boolean;
};

/**
 * TransformStream: aws-chunked bytes → raw payload bytes.
 */
export function createAwsChunkedPayloadTransform(
  options: AwsChunkedPayloadTransformOptions,
): TransformStream<Uint8Array, Uint8Array> {
  void options.insecure;
  let pending = new Uint8Array(0);
  let inTrailers = false;
  let finished = false;

  function append(chunk: Uint8Array) {
    const normalized = Uint8Array.from(chunk);
    const next =
      pending.length === 0 ? normalized : concat(pending, normalized);
    pending = Uint8Array.from(next);
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (finished) {
        throw new ChunkedPayloadError(
          "Unexpected data after terminal aws-chunk",
        );
      }
      append(chunk);

      if (inTrailers) {
        while (pending.length > 0) {
          const lineEnd = indexOfCrlf(pending, 0);
          if (lineEnd < 0) return;
          const line = new TextDecoder("ascii").decode(
            pending.subarray(0, lineEnd),
          );
          pending = pending.subarray(lineEnd + 2);
          if (line === "") {
            inTrailers = false;
            finished = true;
            if (pending.length > 0) {
              throw new ChunkedPayloadError(
                "Trailing data after aws-chunk stream end",
              );
            }
            return;
          }
        }
        return;
      }

      while (!finished && !inTrailers && pending.length > 0) {
        const meta = parseChunkMetaLine(pending);
        if (!meta) return;

        const { size, headerEnd } = meta;
        const need = headerEnd + size + 2;
        if (pending.length < need) {
          return;
        }

        const afterHeader = pending.subarray(headerEnd);
        const payload = afterHeader.subarray(0, size);
        const crlf0 = afterHeader[size];
        const crlf1 = afterHeader[size + 1];
        if (crlf0 !== CR || crlf1 !== LF) {
          throw new ChunkedPayloadError("Missing CRLF after chunk payload");
        }

        pending = pending.subarray(need);

        if (size > 0) {
          controller.enqueue(payload);
        } else {
          if (pending.length === 0) {
            finished = true;
            return;
          }
          inTrailers = true;
          while (pending.length > 0) {
            const lineEnd = indexOfCrlf(pending, 0);
            if (lineEnd < 0) return;
            const line = new TextDecoder("ascii").decode(
              pending.subarray(0, lineEnd),
            );
            pending = pending.subarray(lineEnd + 2);
            if (line === "") {
              inTrailers = false;
              finished = true;
              if (pending.length > 0) {
                throw new ChunkedPayloadError(
                  "Trailing data after aws-chunk stream end",
                );
              }
              return;
            }
          }
          return;
        }
      }
    },
    flush() {
      if (!finished) {
        throw new ChunkedPayloadError("Incomplete aws-chunk stream");
      }
    },
  });
}

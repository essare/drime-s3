export type PutObjectOptions = {
  url: string;
  file: File | Blob;
  onProgress: (pct: number) => void;
  signal?: AbortSignal;
};

export class UploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

/**
 * Single-shot PUT with upload progress. Retry policy is left to callers (v1: no retries).
 */
export function putObjectXHR(opts: PutObjectOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.url, true);
    xhr.withCredentials = true;
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else
        reject(new UploadError(xhr.status, xhr.responseText || xhr.statusText));
    });
    xhr.addEventListener("error", () => reject(new UploadError(0, "network")));
    xhr.addEventListener("abort", () => reject(new UploadError(0, "aborted")));
    if (opts.signal) {
      const onAbort = () => xhr.abort();
      if (opts.signal.aborted) xhr.abort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    xhr.send(opts.file);
  });
}

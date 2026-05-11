import { useQueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";

import { buildObjectUrl } from "@/lib/object-url";
import type { UploadItem } from "@/lib/upload-queue";
import {
  initialState,
  MAX_CONCURRENT,
  MAX_FILE_SIZE_BYTES,
  selectQueued,
  uploadReducer,
} from "@/lib/upload-queue";
import { putObjectXHR, UploadError } from "@/lib/upload-xhr";
import { randomUuid } from "@/lib/utils";

export type EnqueueArg = {
  file: File;
  relativePath?: string;
};

function normalizeFolderPrefix(prefix: string): string {
  if (!prefix) return "";
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function invalidateObjectsDebounced(
  queryClient: ReturnType<typeof useQueryClient>,
  bucket: string,
  timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  delayMs: number,
) {
  if (timerRef.current !== null) clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => {
    timerRef.current = null;
    void queryClient.invalidateQueries({
      queryKey: ["admin", "objects", bucket],
    });
  }, delayMs);
}

export function useUploadQueue({
  bucket,
  prefix,
}: {
  bucket: string;
  prefix: string;
}) {
  const [state, dispatch] = useReducer(uploadReducer, initialState);
  const queryClient = useQueryClient();
  const abortMap = useRef<Map<string, AbortController>>(new Map());
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folderPrefix = useMemo(() => normalizeFolderPrefix(prefix), [prefix]);

  const queuedCount = state.items.filter((i) => i.status === "queued").length;

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    return () => {
      if (invalidateTimerRef.current !== null) {
        clearTimeout(invalidateTimerRef.current);
      }
      for (const c of abortMap.current.values()) {
        c.abort();
      }
      abortMap.current.clear();
    };
  }, []);

  const enqueue = useCallback((args: EnqueueArg[]) => {
    const items: UploadItem[] = [];

    for (const a of args) {
      if (a.file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`"${a.file.name}" is larger than 5 GB; skipped`);
        continue;
      }
      const rel = (a.relativePath ?? a.file.name).replace(/^\/+/, "");
      if (rel.split("/").includes("..")) {
        toast.error(`"${a.file.name}" has invalid path; skipped`);
        continue;
      }
      items.push({
        id: randomUuid(),
        file: a.file,
        relativePath: rel,
        status: "queued",
        progress: 0,
      });
    }
    if (items.length > 0) dispatch({ kind: "enqueue", items });
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const ac = abortMap.current.get(id);
      if (ac) {
        ac.abort();
        return;
      }
      if (state.items.some((i) => i.id === id && i.status === "queued")) {
        dispatch({ kind: "remove", id });
      }
    },
    [state.items],
  );

  const clearCompleted = useCallback(
    () => dispatch({ kind: "clear-completed" }),
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` + queued head drive the pump; omitting them breaks concurrency. We intentionally exclude full `state` so progress events do not abort in-flight XHR.
  useEffect(() => {
    if (bucket.length === 0) return;
    const current = stateRef.current;
    if (current.active >= MAX_CONCURRENT) return;
    const next = selectQueued(current)[0];
    if (!next) return;

    const ac = new AbortController();

    dispatch({ kind: "start", id: next.id });

    abortMap.current.set(next.id, ac);

    const key = `${folderPrefix}${next.relativePath}`.replace(/^\/+/, "");
    const url = buildObjectUrl(bucket, key);

    putObjectXHR({
      url,
      file: next.file,
      onProgress: (pct) =>
        dispatch({ kind: "progress", id: next.id, progress: pct }),
      signal: ac.signal,
    })
      .then(() => {
        dispatch({ kind: "succeed", id: next.id });
        invalidateObjectsDebounced(
          queryClient,
          bucket,
          invalidateTimerRef,
          400,
        );
        setTimeout(() => dispatch({ kind: "remove", id: next.id }), 4000);
      })
      .catch((e: unknown) => {
        let message = "Unknown error";
        if (e instanceof UploadError) {
          message =
            e.status === 0
              ? e.message
              : `${e.status}${e.message ? `: ${e.message}` : ""}`;
        } else if (e instanceof Error) message = e.message;
        dispatch({ kind: "fail", id: next.id, message });
      })
      .finally(() => {
        abortMap.current.delete(next.id);
      });
  }, [state.active, queuedCount, bucket, folderPrefix, queryClient]);

  return { state, enqueue, cancel, clearCompleted };
}

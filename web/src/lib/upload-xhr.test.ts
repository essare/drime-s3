import { describe, expect, it } from "vitest";

import {
  initialState,
  MAX_CONCURRENT,
  selectIsBusy,
  selectQueued,
  type UploadItem,
  uploadReducer,
} from "@/lib/upload-queue";

function item(
  partial: Partial<UploadItem> & Pick<UploadItem, "id">,
): UploadItem {
  return {
    file: partial.file ?? new File([], "x.txt"),
    relativePath: partial.relativePath ?? "x.txt",
    status: partial.status ?? "queued",
    progress: partial.progress ?? 0,
    errorMessage: partial.errorMessage,
    ...partial,
  };
}

describe("uploadReducer", () => {
  it("enqueue adds items without changing active", () => {
    const a = item({ id: "a", relativePath: "a.txt" });
    const b = item({ id: "b", relativePath: "b.txt" });
    const next = uploadReducer(initialState, {
      kind: "enqueue",
      items: [a, b],
    });
    expect(next.items).toHaveLength(2);
    expect(next.active).toBe(0);
  });

  it("start marks queued item uploading and increments active", () => {
    const s0 = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a" })],
    });
    const s1 = uploadReducer(s0, { kind: "start", id: "a" });
    expect(s1.active).toBe(1);
    expect(s1.items[0]?.status).toBe("uploading");
  });

  it("start is a no-op when the item is not queued", () => {
    const s0 = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a" })],
    });
    const s1 = uploadReducer(s0, { kind: "start", id: "a" });
    const s2 = uploadReducer(s1, { kind: "start", id: "a" });
    expect(s2).toEqual(s1);
  });

  it("progress updates only uploading items", () => {
    const s0 = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a" }), item({ id: "b" })],
    });
    const s1 = uploadReducer(s0, { kind: "start", id: "a" });
    const s2 = uploadReducer(s1, {
      kind: "progress",
      id: "a",
      progress: 42,
    });
    expect(s2.items[0]?.progress).toBe(42);
    const s3 = uploadReducer(s2, {
      kind: "progress",
      id: "b",
      progress: 99,
    });
    expect(s3.items[1]?.progress).toBe(0);
  });

  it("succeed marks success, sets progress 100, decrements active", () => {
    const s0 = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a" })],
    });
    const s1 = uploadReducer(s0, { kind: "start", id: "a" });
    const s2 = uploadReducer(s1, { kind: "succeed", id: "a" });
    expect(s2.items[0]?.status).toBe("success");
    expect(s2.items[0]?.progress).toBe(100);
    expect(s2.active).toBe(0);
  });

  it("fail records error and decrements active", () => {
    const s0 = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a" })],
    });
    const s1 = uploadReducer(s0, { kind: "start", id: "a" });
    const s2 = uploadReducer(s1, {
      kind: "fail",
      id: "a",
      message: "boom",
    });
    expect(s2.items[0]?.status).toBe("error");
    expect(s2.items[0]?.errorMessage).toBe("boom");
    expect(s2.active).toBe(0);
  });

  it("remove deletes by id", () => {
    const s0 = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a" }), item({ id: "b" })],
    });
    const s1 = uploadReducer(s0, { kind: "remove", id: "a" });
    expect(s1.items.map((i) => i.id)).toEqual(["b"]);
  });

  it("clear-completed keeps queued and uploading only", () => {
    const s0: ReturnType<typeof uploadReducer> = {
      items: [
        item({ id: "q", status: "queued" }),
        item({ id: "u", status: "uploading" }),
        item({ id: "ok", status: "success" }),
        item({ id: "bad", status: "error", errorMessage: "x" }),
      ],
      active: 1,
    };
    const s1 = uploadReducer(s0, { kind: "clear-completed" });
    expect(s1.items.map((i) => i.id)).toEqual(["q", "u"]);
  });

  it("selectQueued preserves enqueue order", () => {
    const s = uploadReducer(initialState, {
      kind: "enqueue",
      items: [
        item({ id: "a", relativePath: "a" }),
        item({ id: "b", relativePath: "b" }),
      ],
    });
    expect(selectQueued(s).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("selectIsBusy when queued or active uploads", () => {
    const idle = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a", status: "success" })],
    });
    expect(selectIsBusy(idle)).toBe(false);

    const queued = uploadReducer(initialState, {
      kind: "enqueue",
      items: [item({ id: "a" })],
    });
    expect(selectIsBusy(queued)).toBe(true);

    const uploading = uploadReducer(queued, { kind: "start", id: "a" });
    expect(selectIsBusy(uploading)).toBe(true);
    expect(uploading.active).toBeLessThanOrEqual(MAX_CONCURRENT);
  });
});

describe("crypto.randomUUID", () => {
  it("is available in the Vitest jsdom environment", () => {
    expect(typeof crypto.randomUUID).toBe("function");
    expect(crypto.randomUUID()).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

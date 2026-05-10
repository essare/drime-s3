export type UploadStatus = "queued" | "uploading" | "success" | "error";

export type UploadItem = {
  id: string;
  file: File;
  relativePath: string;
  status: UploadStatus;
  progress: number;
  errorMessage?: string;
};

export type UploadState = {
  items: UploadItem[];
  active: number;
};

export type UploadAction =
  | { kind: "enqueue"; items: UploadItem[] }
  | { kind: "start"; id: string }
  | { kind: "progress"; id: string; progress: number }
  | { kind: "succeed"; id: string }
  | { kind: "fail"; id: string; message: string }
  | { kind: "remove"; id: string }
  | { kind: "clear-completed" };

export const MAX_CONCURRENT = 3;
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

export const initialState: UploadState = { items: [], active: 0 };

function clampProgress(p: number): number {
  return Math.min(100, Math.max(0, p));
}

export function uploadReducer(
  state: UploadState,
  action: UploadAction,
): UploadState {
  switch (action.kind) {
    case "enqueue": {
      if (action.items.length === 0) return state;
      return {
        ...state,
        items: [...state.items, ...action.items],
      };
    }
    case "start": {
      const idx = state.items.findIndex((i) => i.id === action.id);
      if (idx === -1) return state;
      const item = state.items[idx];
      if (item.status !== "queued") return state;
      const nextItems = [...state.items];
      nextItems[idx] = {
        ...item,
        status: "uploading",
        progress: item.progress,
      };
      return {
        ...state,
        items: nextItems,
        active: state.active + 1,
      };
    }
    case "progress": {
      const idx = state.items.findIndex((i) => i.id === action.id);
      if (idx === -1) return state;
      const item = state.items[idx];
      if (item.status !== "uploading") return state;
      const nextItems = [...state.items];
      nextItems[idx] = {
        ...item,
        progress: clampProgress(action.progress),
      };
      return { ...state, items: nextItems };
    }
    case "succeed": {
      const idx = state.items.findIndex((i) => i.id === action.id);
      if (idx === -1) return state;
      const item = state.items[idx];
      if (item.status !== "uploading") return state;
      const nextItems = [...state.items];
      nextItems[idx] = {
        ...item,
        status: "success",
        progress: 100,
      };
      return {
        ...state,
        items: nextItems,
        active: Math.max(0, state.active - 1),
      };
    }
    case "fail": {
      const idx = state.items.findIndex((i) => i.id === action.id);
      if (idx === -1) return state;
      const item = state.items[idx];
      if (item.status !== "uploading") return state;
      const nextItems = [...state.items];
      nextItems[idx] = {
        ...item,
        status: "error",
        errorMessage: action.message,
      };
      return {
        ...state,
        items: nextItems,
        active: Math.max(0, state.active - 1),
      };
    }
    case "remove": {
      return {
        ...state,
        items: state.items.filter((i) => i.id !== action.id),
      };
    }
    case "clear-completed": {
      const items = state.items.filter(
        (i) => i.status === "queued" || i.status === "uploading",
      );
      const active = items.filter((i) => i.status === "uploading").length;
      return {
        ...state,
        items,
        active,
      };
    }
  }
}

export function selectQueued(state: UploadState): UploadItem[] {
  return state.items.filter((i) => i.status === "queued");
}

export function selectUploading(state: UploadState): UploadItem[] {
  return state.items.filter((i) => i.status === "uploading");
}

export function selectIsBusy(state: UploadState): boolean {
  return state.active > 0 || state.items.some((i) => i.status === "queued");
}

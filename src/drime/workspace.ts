/** One row from `GET /me/workspaces` after normalization. */
export type WorkspaceRow = {
  id: number;
  name: string;
};

function parseWorkspaceRow(x: unknown): WorkspaceRow | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const id = Number(o.id);
  const name = o.name;
  if (!Number.isFinite(id) || typeof name !== "string" || name.length === 0) {
    return null;
  }
  return { id, name };
}

/**
 * Normalize Drime `GET /me/workspaces` JSON (shape varies by API version).
 */
export function parseWorkspaceList(json: unknown): WorkspaceRow[] {
  if (Array.isArray(json)) {
    return json
      .map(parseWorkspaceRow)
      .filter((r): r is WorkspaceRow => r !== null);
  }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const data = o.data ?? o.workspaces ?? o.items;
    if (Array.isArray(data)) {
      return data
        .map(parseWorkspaceRow)
        .filter((r): r is WorkspaceRow => r !== null);
    }
  }
  return [];
}

/**
 * Parse `POST /workspace` response for created workspace id.
 */
export function parseWorkspaceCreate(json: unknown): number {
  if (!json || typeof json !== "object") {
    throw new Error("createWorkspace: expected JSON object body");
  }
  const o = json as Record<string, unknown>;
  const nested =
    o.workspace && typeof o.workspace === "object"
      ? (o.workspace as Record<string, unknown>)
      : o.data && typeof o.data === "object"
        ? (o.data as Record<string, unknown>)
        : o;
  const id = Number(nested.id);
  if (!Number.isFinite(id)) {
    throw new Error("createWorkspace: missing numeric id in response");
  }
  return id;
}

export function findWorkspaceIdByName(
  rows: WorkspaceRow[],
  name: string,
): number | undefined {
  const hit = rows.find((w) => w.name === name);
  return hit?.id;
}

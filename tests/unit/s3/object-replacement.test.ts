import { describe, expect, test } from "bun:test";
import pino from "pino";
import { DrimeApiError } from "../../../src/drime/client";
import type { FileEntry } from "../../../src/drime/types";
import {
  type CommitObjectReplacementOptions,
  commitObjectReplacement,
  ObjectReplacementError,
} from "../../../src/s3/object-replacement";
import type { AppContext } from "../../../src/server-context";

const MD5 = "d41d8cd98f00b204e9800998ecf8427e";
const PARENT_ID = 41;
const WORKSPACE_ID = 3;
const OLD_ID = 12;
const CANDIDATE_ID = 77;
const SECRET = "super-secret-token";

/** Exact production response body for a stale `POST /file-entries/delete`. */
const INVALID_IDS_BODY = JSON.stringify({
  message: "The selected entry ids is invalid.",
  errors: { entryIds: ["The selected entry ids is invalid."] },
});

const fileEntry = (id: number, name: string): FileEntry => ({
  id,
  name,
  parent_id: PARENT_ID,
  is_folder: false,
  file_size: 10,
  hash: null,
  mime: "application/octet-stream",
  updated_at: null,
  created_at: null,
  description: `md5:${"0".repeat(32)}`,
  url: null,
});

const oldRow = () => fileEntry(OLD_ID, "backup.bin");
const candidateRow = () => fileEntry(CANDIDATE_ID, "backup.bin");

type LogRecord = {
  level: "info" | "warn" | "error";
  msg: string;
  fields: Record<string, unknown>;
};

type FakeDrime = {
  updateDescription?: (id: number, description: string) => Promise<void>;
  deleteEntries?: (ids: number[]) => Promise<void>;
  /** One entry per confirmation poll; throwing simulates a failed listing. */
  listFolder?: (attempt: number) => FileEntry[];
};

function createFakeContext(fake: FakeDrime = {}) {
  const calls: string[] = [];
  const logs: LogRecord[] = [];
  const descriptions: string[] = [];
  const sleeps: number[] = [];
  const replacements: {
    folderId: number | null;
    oldEntryId: number | undefined;
    newEntry: FileEntry;
  }[] = [];
  let listAttempts = 0;

  const log = (level: LogRecord["level"]) => (fields: unknown, msg: string) => {
    logs.push({ level, msg, fields: fields as Record<string, unknown> });
  };

  const ctx = {
    drime: {
      updateFileEntryDescription: async (id: number, description: string) => {
        calls.push(`update:${id}`);
        descriptions.push(description);
        await fake.updateDescription?.(id, description);
      },
      deleteEntriesForever: async (ids: number[]) => {
        calls.push(`delete:${ids.join(",")}`);
        await fake.deleteEntries?.(ids);
        return {};
      },
      listFolder: async (parentId: number | null, workspaceId: number) => {
        calls.push(`list:${parentId}:${workspaceId}`);
        listAttempts += 1;
        return fake.listFolder?.(listAttempts) ?? [];
      },
    },
    listCache: {
      replaceEntry: (
        folderId: number | null,
        oldEntryId: number | undefined,
        newEntry: FileEntry,
      ) => {
        calls.push(
          `replaceEntry:${folderId}:${oldEntryId ?? "none"}:${newEntry.id}`,
        );
        replacements.push({ folderId, oldEntryId, newEntry });
      },
      getOrFetch: async () => {
        calls.push("listCacheFetch");
        return [];
      },
      invalidate: (folderId: number | null) => {
        calls.push(`invalidate:${folderId}`);
      },
      addEntry: () => calls.push("addEntry"),
      removeEntryById: () => calls.push("removeEntryById"),
    },
    logger: {
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
      debug: () => {},
    },
  } as unknown as AppContext;

  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
  };

  return { ctx, calls, logs, descriptions, sleeps, sleep, replacements };
}

function baseOpts(
  sleep: (ms: number) => Promise<void>,
  over: Partial<CommitObjectReplacementOptions> = {},
): CommitObjectReplacementOptions {
  return {
    rawCandidate: { fileEntry: { id: CANDIDATE_ID, name: "backup.bin" } },
    oldEntry: oldRow(),
    parentId: PARENT_ID,
    workspaceId: WORKSPACE_ID,
    bucket: "production",
    key: "backups/backup.bin",
    name: "backup.bin",
    size: 1024,
    mime: "application/octet-stream",
    publicEtag: `"${MD5}"`,
    tagging: null,
    staleDelete: { sleep },
    ...over,
  };
}

const messages = (logs: LogRecord[]): string[] => logs.map((l) => l.msg);

async function expectStage(
  promise: Promise<unknown>,
  stage: ObjectReplacementError["stage"],
): Promise<ObjectReplacementError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ObjectReplacementError);
    const replacementError = error as ObjectReplacementError;
    expect(replacementError.stage).toBe(stage);
    return replacementError;
  }
  throw new Error(`Expected ObjectReplacementError with stage ${stage}.`);
}

/** Serialize exactly as a handler would when logging a coordinator failure. */
function serializeWithPino(error: unknown): string {
  const lines: string[] = [];
  const logger = pino(
    { level: "error" },
    {
      write: (line: string) => {
        lines.push(line);
      },
    },
  );
  logger.error({ err: error }, "replacement_failed");
  return lines.join("");
}

describe("commitObjectReplacement", () => {
  test("persists the ETag before deleting the old entry, then publishes", async () => {
    const fake = createFakeContext();

    const committed = await commitObjectReplacement(
      fake.ctx,
      baseOpts(fake.sleep),
    );

    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `delete:${OLD_ID}`,
      `replaceEntry:${PARENT_ID}:${OLD_ID}:${CANDIDATE_ID}`,
    ]);
    expect(fake.descriptions).toEqual([`md5:${MD5}`]);
    expect(committed.id).toBe(CANDIDATE_ID);
    expect(committed.description).toBe(`md5:${MD5}`);
    expect(committed.parent_id).toBe(PARENT_ID);
    expect(committed.file_size).toBe(1024);
    expect(fake.replacements).toEqual([
      { folderId: PARENT_ID, oldEntryId: OLD_ID, newEntry: committed },
    ]);
    expect(messages(fake.logs)).toEqual([
      "candidate_registered",
      "replacement_committed",
    ]);
    for (const record of fake.logs) {
      expect(record.fields.bucket).toBe("production");
      expect(record.fields.key).toBe("backups/backup.bin");
    }
  });

  test("persists the tagging line alongside the stripped ETag", async () => {
    const fake = createFakeContext();

    const committed = await commitObjectReplacement(
      fake.ctx,
      baseOpts(fake.sleep, { tagging: "team=ops&tier=cold" }),
    );

    expect(fake.descriptions).toEqual([`md5:${MD5}\ns3tag:team=ops&tier=cold`]);
    expect(committed.description).toBe(`md5:${MD5}\ns3tag:team=ops&tier=cold`);
  });

  test("accepts a composite multipart ETag and normalizes hex case", async () => {
    const fake = createFakeContext();

    const committed = await commitObjectReplacement(
      fake.ctx,
      baseOpts(fake.sleep, { publicEtag: `"${MD5.toUpperCase()}-13"` }),
    );

    expect(fake.descriptions).toEqual([`md5:${MD5}-13`]);
    expect(committed.description).toBe(`md5:${MD5}-13`);
  });

  test("rejects a public ETag that is not an MD5 or composite ETag", async () => {
    for (const publicEtag of [
      '"not-an-etag"',
      `"${MD5}-0"`,
      `"${MD5}extra"`,
      '""',
    ]) {
      const fake = createFakeContext();

      await expectStage(
        commitObjectReplacement(fake.ctx, baseOpts(fake.sleep, { publicEtag })),
        "etag_persist",
      );

      /** Nothing is persisted, the old entry is untouched, the junk candidate goes. */
      expect(fake.calls).toEqual([`delete:${CANDIDATE_ID}`]);
      expect(fake.descriptions).toEqual([]);
      expect(fake.replacements).toEqual([]);
      expect(messages(fake.logs)).toEqual([
        "candidate_registered",
        "etag_persist_failed",
      ]);
    }
  });

  test("skips deletion when there is no old entry", async () => {
    const fake = createFakeContext();

    await commitObjectReplacement(
      fake.ctx,
      baseOpts(fake.sleep, { oldEntry: undefined }),
    );

    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `replaceEntry:${PARENT_ID}:none:${CANDIDATE_ID}`,
    ]);
    expect(fake.replacements[0]?.oldEntryId).toBeUndefined();
  });

  test("metadata failure deletes only the candidate and keeps the old entry", async () => {
    const fake = createFakeContext({
      updateDescription: async () => {
        throw new Error("metadata rejected");
      },
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "etag_persist",
    );

    expect((error.cause as Error).message).toContain("metadata rejected");
    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `delete:${CANDIDATE_ID}`,
    ]);
    expect(fake.replacements).toEqual([]);
    expect(messages(fake.logs)).toEqual([
      "candidate_registered",
      "etag_persist_failed",
    ]);
  });

  test("sanitizes metadata-failure causes so Pino cannot serialize the body", async () => {
    const fake = createFakeContext({
      updateDescription: async () => {
        throw new DrimeApiError(
          500,
          JSON.stringify({ message: "boom", token: SECRET }),
        );
      },
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "etag_persist",
    );

    const cause = error.cause as Error;
    expect(cause).toBeInstanceOf(Error);
    expect(cause).not.toBeInstanceOf(DrimeApiError);
    expect(cause.message).toContain("Drime API error 500");
    expect(serializeWithPino(error)).not.toContain(SECRET);
    expect(JSON.stringify(fake.logs)).not.toContain(SECRET);
  });

  test("sanitizes delete-failure and rollback causes so Pino cannot serialize the body", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) {
          throw new DrimeApiError(
            503,
            JSON.stringify({ message: "unavailable", token: SECRET }),
          );
        }
        throw new DrimeApiError(
          500,
          JSON.stringify({ message: "rollback blocked", token: SECRET }),
        );
      },
      listFolder: () => [oldRow(), candidateRow()],
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "candidate_rollback",
    );

    const serialized = serializeWithPino(error);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain("Drime API error 503");
    expect(JSON.stringify(fake.logs)).not.toContain(SECRET);
  });

  test("confirms every ambiguous delete through direct listings, never the list cache", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) throw new Error("socket hang up");
      },
      listFolder: () => [candidateRow()],
    });

    await commitObjectReplacement(fake.ctx, baseOpts(fake.sleep));

    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `delete:${OLD_ID}`,
      `list:${PARENT_ID}:${WORKSPACE_ID}`,
      `replaceEntry:${PARENT_ID}:${OLD_ID}:${CANDIDATE_ID}`,
    ]);
    expect(fake.calls).not.toContain("listCacheFetch");
  });

  test("commits after a 504 whose deletion actually applied", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) {
          throw new DrimeApiError(504, "<html>Gateway Timeout</html>");
        }
      },
      /** Stale listing converges: the old row disappears on the third poll. */
      listFolder: (attempt) =>
        attempt < 3 ? [oldRow(), candidateRow()] : [candidateRow()],
    });

    const committed = await commitObjectReplacement(
      fake.ctx,
      baseOpts(fake.sleep),
    );

    expect(committed.id).toBe(CANDIDATE_ID);
    expect(fake.sleeps).toEqual([250, 500]);
    expect(fake.calls.at(-1)).toBe(
      `replaceEntry:${PARENT_ID}:${OLD_ID}:${CANDIDATE_ID}`,
    );
    const confirmLog = fake.logs[1];
    expect(confirmLog?.msg).toBe("old_delete_failed");
    expect(confirmLog?.level).toBe("warn");
    expect(confirmLog?.fields.confirmation).toBe("committed");
  });

  test("commits when the invalid-entry-ids 422 is confirmed by a fresh listing", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) {
          throw new DrimeApiError(422, INVALID_IDS_BODY);
        }
      },
      listFolder: () => [candidateRow()],
    });

    const committed = await commitObjectReplacement(
      fake.ctx,
      baseOpts(fake.sleep),
    );

    expect(committed.id).toBe(CANDIDATE_ID);
    expect(fake.sleeps).toEqual([]);
    expect(messages(fake.logs)).toEqual([
      "candidate_registered",
      "old_delete_failed",
      "replacement_committed",
    ]);
    expect(fake.logs[1]?.fields.invalidEntryIds).toBe(true);
  });

  test("rolls back the candidate when the old entry is still present", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) {
          throw new DrimeApiError(422, INVALID_IDS_BODY);
        }
      },
      listFolder: () => [oldRow(), candidateRow()],
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "old_delete",
    );

    expect((error.cause as Error).message).toContain("Drime API error 422");
    const listCalls = fake.calls.filter((c) => c.startsWith("list:"));
    expect(listCalls).toHaveLength(5);
    expect(fake.sleeps).toEqual([250, 500, 1000, 2000]);
    expect(fake.calls.at(-1)).toBe(`delete:${CANDIDATE_ID}`);
    expect(fake.replacements).toEqual([]);
    expect(fake.logs.at(-1)?.fields.confirmation).toBe("old_present");
  });

  test("does not accept a listing that is missing the candidate as success", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) throw new Error("connection reset");
      },
      /** Neither row is visible: nothing about the delete is established. */
      listFolder: () => [],
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "old_delete",
    );

    expect(error.message).toContain("could not be confirmed");
    expect(fake.calls).not.toContain(`delete:${CANDIDATE_ID}`);
    expect(fake.replacements).toEqual([]);
    expect(messages(fake.logs)).toEqual([
      "candidate_registered",
      "old_delete_failed",
      "replacement_ambiguous_data_preserved",
    ]);
    const preservedLog = fake.logs.at(-1);
    expect(preservedLog?.level).toBe("error");
    expect(preservedLog?.fields.candidateRetained).toBe(true);
    expect(preservedLog?.fields.confirmation).toBe("unknown");
    expect(preservedLog?.fields.candidateId).toBe(CANDIDATE_ID);
    expect(preservedLog?.fields.oldEntryId).toBe(OLD_ID);
  });

  test("preserves the candidate when every confirmation listing fails", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) throw new Error("connection reset");
      },
      listFolder: () => {
        throw new DrimeApiError(500, `{"token":"${SECRET}"}`);
      },
    });

    await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "old_delete",
    );

    const listCalls = fake.calls.filter((c) => c.startsWith("list:"));
    expect(listCalls).toHaveLength(5);
    expect(fake.sleeps).toEqual([250, 500, 1000, 2000]);
    expect(fake.calls).not.toContain(`delete:${CANDIDATE_ID}`);
    expect(fake.replacements).toEqual([]);
    expect(messages(fake.logs).at(-1)).toBe(
      "replacement_ambiguous_data_preserved",
    );
    expect(String(fake.logs.at(-1)?.fields.confirmErr)).toContain(
      "Drime API error 500",
    );
    expect(JSON.stringify(fake.logs)).not.toContain(SECRET);
  });

  test("preserves the candidate when the final listing leaves the state unknown", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) throw new Error("connection reset");
      },
      /** Old row seen early, but the decisive final listing never lands. */
      listFolder: (attempt) => {
        if (attempt >= 5) throw new Error("listing unavailable");
        return [oldRow(), candidateRow()];
      },
    });

    await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "old_delete",
    );

    expect(fake.calls).not.toContain(`delete:${CANDIDATE_ID}`);
    expect(fake.replacements).toEqual([]);
    expect(messages(fake.logs).at(-1)).toBe(
      "replacement_ambiguous_data_preserved",
    );
    expect(fake.logs.at(-1)?.fields.confirmation).toBe("unknown");
  });

  test("rollback failure reports candidate_rollback without masking the cause", async () => {
    const fake = createFakeContext({
      updateDescription: async () => {
        throw new Error("metadata rejected");
      },
      deleteEntries: async () => {
        throw new Error("candidate delete rejected");
      },
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts(fake.sleep)),
      "candidate_rollback",
    );

    const cause = error.cause as ObjectReplacementError;
    expect(cause).toBeInstanceOf(ObjectReplacementError);
    expect(cause.stage).toBe("etag_persist");
    expect((cause.cause as Error).message).toContain("metadata rejected");
    expect(messages(fake.logs)).toEqual([
      "candidate_registered",
      "etag_persist_failed",
      "replacement_rollback_failed",
    ]);
    const rollbackLog = fake.logs.at(-1);
    expect(rollbackLog?.level).toBe("error");
    expect(rollbackLog?.fields.stage).toBe("etag_persist");
    expect(String(rollbackLog?.fields.err)).toContain("metadata rejected");
    expect(String(rollbackLog?.fields.rollbackErr)).toContain(
      "candidate delete rejected",
    );
    expect(fake.replacements).toEqual([]);
  });

  test("an unidentifiable candidate fails as candidate_parse and never guesses an id", async () => {
    const fake = createFakeContext();

    const error = await expectStage(
      commitObjectReplacement(
        fake.ctx,
        baseOpts(fake.sleep, { rawCandidate: { status: "ok" } }),
      ),
      "candidate_parse",
    );

    expect(error.cause).toBeInstanceOf(Error);
    expect(fake.calls).toEqual([]);
    expect(fake.replacements).toEqual([]);
    expect(messages(fake.logs)).toEqual(["orphan_candidate"]);
    const orphanLog = fake.logs[0];
    expect(orphanLog?.level).toBe("error");
    expect(orphanLog?.fields.oldEntryId).toBe(OLD_ID);
    expect(orphanLog?.fields.candidateId).toBeUndefined();
  });

  test("never logs the raw upstream candidate payload", async () => {
    const fake = createFakeContext();

    const error = await expectStage(
      commitObjectReplacement(
        fake.ctx,
        baseOpts(fake.sleep, {
          rawCandidate: { status: "ok", authorization: `Bearer ${SECRET}` },
        }),
      ),
      "candidate_parse",
    );

    expect(JSON.stringify(fake.logs)).not.toContain(SECRET);
    expect(serializeWithPino(error)).not.toContain(SECRET);
  });
});

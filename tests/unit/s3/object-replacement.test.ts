import { describe, expect, test } from "bun:test";
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

type LogRecord = {
  level: "info" | "warn" | "error";
  msg: string;
  fields: Record<string, unknown>;
};

type FakeDrime = {
  updateDescription?: (id: number, description: string) => Promise<void>;
  deleteEntries?: (ids: number[]) => Promise<void>;
  listFolder?: (parentId: number | null, workspaceId: number) => FileEntry[];
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
        return fake.listFolder?.(parentId, workspaceId) ?? [];
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
  over: Partial<CommitObjectReplacementOptions> = {},
): CommitObjectReplacementOptions {
  return {
    rawCandidate: { fileEntry: { id: CANDIDATE_ID, name: "backup.bin" } },
    oldEntry: fileEntry(OLD_ID, "backup.bin"),
    parentId: PARENT_ID,
    workspaceId: WORKSPACE_ID,
    bucket: "production",
    key: "backups/backup.bin",
    name: "backup.bin",
    size: 1024,
    mime: "application/octet-stream",
    publicEtag: `"${MD5}"`,
    tagging: null,
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

describe("commitObjectReplacement", () => {
  test("persists the ETag before deleting the old entry, then publishes", async () => {
    const fake = createFakeContext();

    const committed = await commitObjectReplacement(fake.ctx, baseOpts());

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
      baseOpts({ tagging: "team=ops&tier=cold" }),
    );

    expect(fake.descriptions).toEqual([`md5:${MD5}\ns3tag:team=ops&tier=cold`]);
    expect(committed.description).toBe(`md5:${MD5}\ns3tag:team=ops&tier=cold`);
  });

  test("skips deletion when there is no old entry", async () => {
    const fake = createFakeContext();

    await commitObjectReplacement(fake.ctx, baseOpts({ oldEntry: undefined }));

    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `replaceEntry:${PARENT_ID}:none:${CANDIDATE_ID}`,
    ]);
    expect(fake.replacements[0]?.oldEntryId).toBeUndefined();
  });

  test("metadata failure deletes only the candidate and keeps the old entry", async () => {
    const persistError = new Error("metadata rejected");
    const fake = createFakeContext({
      updateDescription: async () => {
        throw persistError;
      },
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts()),
      "etag_persist",
    );

    expect(error.cause).toBe(persistError);
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

  test("old deletion failure rolls back the candidate and does not publish", async () => {
    const deleteError = new Error("drime unavailable");
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) throw deleteError;
      },
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts()),
      "old_delete",
    );

    expect(error.cause).toBe(deleteError);
    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `delete:${OLD_ID}`,
      `delete:${CANDIDATE_ID}`,
    ]);
    expect(fake.replacements).toEqual([]);
    expect(messages(fake.logs)).toEqual([
      "candidate_registered",
      "old_delete_failed",
    ]);
  });

  test("does not treat every 422 as an idempotent delete", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) {
          throw new DrimeApiError(
            422,
            JSON.stringify({ message: "The name field is required." }),
          );
        }
      },
    });

    await expectStage(
      commitObjectReplacement(
        fake.ctx,
        baseOpts({ staleDelete: { sleep: fake.sleep } }),
      ),
      "old_delete",
    );

    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `delete:${OLD_ID}`,
      `delete:${CANDIDATE_ID}`,
    ]);
    expect(fake.sleeps).toEqual([]);
  });

  test("commits when a fresh listing confirms the old entry is already gone", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) {
          throw new DrimeApiError(422, INVALID_IDS_BODY);
        }
      },
      listFolder: () => [fileEntry(CANDIDATE_ID, "backup.bin")],
    });

    const committed = await commitObjectReplacement(
      fake.ctx,
      baseOpts({ staleDelete: { sleep: fake.sleep } }),
    );

    expect(committed.id).toBe(CANDIDATE_ID);
    expect(fake.calls).toEqual([
      `update:${CANDIDATE_ID}`,
      `delete:${OLD_ID}`,
      `list:${PARENT_ID}:${WORKSPACE_ID}`,
      `replaceEntry:${PARENT_ID}:${OLD_ID}:${CANDIDATE_ID}`,
    ]);
    expect(fake.sleeps).toEqual([]);
    expect(messages(fake.logs)).toEqual([
      "candidate_registered",
      "old_delete_failed",
      "replacement_committed",
    ]);
    const confirmLog = fake.logs[1];
    expect(confirmLog?.level).toBe("warn");
    expect(confirmLog?.fields.confirmedAbsent).toBe(true);
  });

  test("bounds confirmation polling with the production delay schedule", async () => {
    const fake = createFakeContext({
      deleteEntries: async (ids) => {
        if (ids.includes(OLD_ID)) {
          throw new DrimeApiError(422, INVALID_IDS_BODY);
        }
      },
      listFolder: () => [fileEntry(OLD_ID, "backup.bin")],
    });

    await expectStage(
      commitObjectReplacement(
        fake.ctx,
        baseOpts({ staleDelete: { sleep: fake.sleep } }),
      ),
      "old_delete",
    );

    const listCalls = fake.calls.filter((c) => c.startsWith("list:"));
    expect(listCalls).toHaveLength(5);
    expect(fake.sleeps).toEqual([250, 500, 1000, 2000]);
    expect(fake.calls.at(-1)).toBe(`delete:${CANDIDATE_ID}`);
    expect(fake.replacements).toEqual([]);
    expect(fake.logs.at(-1)?.fields.confirmedAbsent).toBe(false);
  });

  test("rollback failure reports candidate_rollback without masking the cause", async () => {
    const persistError = new Error("metadata rejected");
    const rollbackError = new Error("candidate delete rejected");
    const fake = createFakeContext({
      updateDescription: async () => {
        throw persistError;
      },
      deleteEntries: async () => {
        throw rollbackError;
      },
    });

    const error = await expectStage(
      commitObjectReplacement(fake.ctx, baseOpts()),
      "candidate_rollback",
    );

    const cause = error.cause as ObjectReplacementError;
    expect(cause).toBeInstanceOf(ObjectReplacementError);
    expect(cause.stage).toBe("etag_persist");
    expect(cause.cause).toBe(persistError);
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
        baseOpts({ rawCandidate: { status: "ok" } }),
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

    await expectStage(
      commitObjectReplacement(
        fake.ctx,
        baseOpts({
          rawCandidate: {
            status: "ok",
            authorization: "Bearer super-secret-token",
          },
        }),
      ),
      "candidate_parse",
    );

    expect(JSON.stringify(fake.logs)).not.toContain("super-secret-token");
  });
});

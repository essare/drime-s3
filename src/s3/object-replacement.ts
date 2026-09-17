import { isInvalidEntryIdsError } from "../drime/client";
import { parseCreatedFileEntry } from "../drime/created-entry";
import type { FileEntry } from "../drime/types";
import type { AppContext } from "../server-context";
import { buildObjectDescription } from "./tagging";

/**
 * Delays between the fresh listings used to confirm that an old entry Drime
 * reported as an invalid id is really gone. Five polls, four waits.
 */
const STALE_DELETE_CONFIRM_DELAYS_MS = [250, 500, 1000, 2000];

const MAX_LOGGED_ERROR_CHARS = 200;

export type StaleDeleteConfirmOptions = {
  /**
   * Test seam for the confirmation poll schedule. Defaults to real timers so
   * production keeps the exact {@link STALE_DELETE_CONFIRM_DELAYS_MS} waits.
   */
  sleep?: (ms: number) => Promise<void>;
};

export type CommitObjectReplacementOptions = {
  /** Raw upload/registration response; never logged. */
  rawCandidate: unknown;
  /** Entry being replaced, when the key already existed. */
  oldEntry?: FileEntry;
  parentId: number;
  workspaceId: number;
  bucket: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  /** Public S3 ETag, quoted or bare. */
  publicEtag: string;
  /** Raw `x-amz-tagging` header value, if any. */
  tagging: string | null;
  staleDelete?: StaleDeleteConfirmOptions;
};

export type ObjectReplacementStage =
  | "candidate_parse"
  | "etag_persist"
  | "old_delete"
  | "candidate_rollback";

export class ObjectReplacementError extends Error {
  readonly name = "ObjectReplacementError";
  readonly stage: ObjectReplacementStage;

  constructor(
    stage: ObjectReplacementStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.stage = stage;
  }
}

type ReplacementLogFields = {
  bucket: string;
  key: string;
  parentId: number;
  oldEntryId?: number;
};

type ConfirmResult = { absent: boolean; listErr?: string };

/** Message only: keeps upstream bodies, keys, and signed URLs out of logs. */
function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LOGGED_ERROR_CHARS);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Commit a create-first object replacement: persist the public ETag on the
 * already-created candidate, delete the old entry, then publish one
 * authoritative cache replacement. The old entry stays readable until its
 * metadata-bearing candidate is fully persisted; any failure before
 * publication rolls the candidate back and leaves the old object in place.
 */
export async function commitObjectReplacement(
  ctx: AppContext,
  opts: CommitObjectReplacementOptions,
): Promise<FileEntry> {
  const md5Hex = opts.publicEtag.trim().replace(/^"+|"+$/g, "");
  const description = buildObjectDescription(md5Hex, opts.tagging);
  const oldEntryId = opts.oldEntry?.id;
  const base: ReplacementLogFields = {
    bucket: opts.bucket,
    key: opts.key,
    parentId: opts.parentId,
    oldEntryId,
  };

  let candidate: FileEntry;
  try {
    candidate = parseCreatedFileEntry(opts.rawCandidate, {
      name: opts.name,
      parentId: opts.parentId,
      size: opts.size,
      mime: opts.mime,
      description,
    });
  } catch (error) {
    /**
     * Without a candidate id there is nothing safe to delete: looking the name
     * up would risk deleting an unrelated or pre-existing duplicate entry.
     */
    ctx.logger.error({ ...base, err: errorMessage(error) }, "orphan_candidate");
    throw new ObjectReplacementError(
      "candidate_parse",
      `Could not identify the created entry for ${opts.bucket}/${opts.key}.`,
      { cause: error },
    );
  }

  const candidateId = candidate.id;
  ctx.logger.info({ ...base, candidateId }, "candidate_registered");

  try {
    await ctx.drime.updateFileEntryDescription(candidateId, description);
  } catch (error) {
    ctx.logger.error(
      { ...base, candidateId, err: errorMessage(error) },
      "etag_persist_failed",
    );
    return await rollbackCandidate(
      ctx,
      base,
      candidateId,
      new ObjectReplacementError(
        "etag_persist",
        `Could not persist the ETag for ${opts.bucket}/${opts.key}.`,
        { cause: error },
      ),
    );
  }

  if (oldEntryId !== undefined) {
    try {
      await ctx.drime.deleteEntriesForever([oldEntryId]);
    } catch (error) {
      const invalidEntryIds = isInvalidEntryIdsError(error);
      const confirmed: ConfirmResult = invalidEntryIds
        ? await confirmOldEntryAbsent(ctx, opts, oldEntryId)
        : { absent: false };

      const fields = {
        ...base,
        candidateId,
        invalidEntryIds,
        confirmedAbsent: confirmed.absent,
        err: errorMessage(error),
        ...(confirmed.listErr ? { confirmErr: confirmed.listErr } : {}),
      };

      if (confirmed.absent) {
        /** Drime already dropped the old entry; the stale row is only a listing artifact. */
        ctx.logger.warn(fields, "old_delete_failed");
      } else {
        ctx.logger.error(fields, "old_delete_failed");
        return await rollbackCandidate(
          ctx,
          base,
          candidateId,
          new ObjectReplacementError(
            "old_delete",
            `Could not delete the replaced entry ${oldEntryId} for ${opts.bucket}/${opts.key}.`,
            { cause: error },
          ),
        );
      }
    }
  }

  const committed: FileEntry = { ...candidate, description };
  ctx.listCache.replaceEntry(opts.parentId, oldEntryId, committed);
  ctx.logger.info({ ...base, candidateId }, "replacement_committed");
  return committed;
}

/**
 * Fresh, uncached listings (never `ListTtlCache`, whose overlays could hide the
 * very row we are checking) proving whether the old id is really gone.
 */
async function confirmOldEntryAbsent(
  ctx: AppContext,
  opts: CommitObjectReplacementOptions,
  oldEntryId: number,
): Promise<ConfirmResult> {
  const sleep = opts.staleDelete?.sleep ?? defaultSleep;
  let listErr: string | undefined;

  for (
    let attempt = 0;
    attempt <= STALE_DELETE_CONFIRM_DELAYS_MS.length;
    attempt++
  ) {
    if (attempt > 0) {
      await sleep(STALE_DELETE_CONFIRM_DELAYS_MS[attempt - 1]);
    }
    try {
      const rows = await ctx.drime.listFolder(opts.parentId, opts.workspaceId);
      if (!rows.some((row) => row.id === oldEntryId)) {
        return { absent: true };
      }
      listErr = undefined;
    } catch (error) {
      listErr = errorMessage(error);
    }
  }

  return { absent: false, listErr };
}

/**
 * Best-effort candidate cleanup that never masks why the replacement failed:
 * the original stage error propagates when cleanup succeeds, and becomes the
 * `cause` of a `candidate_rollback` error when cleanup itself fails.
 */
async function rollbackCandidate(
  ctx: AppContext,
  base: ReplacementLogFields,
  candidateId: number,
  original: ObjectReplacementError,
): Promise<never> {
  try {
    await ctx.drime.deleteEntriesForever([candidateId]);
  } catch (rollbackError) {
    ctx.logger.error(
      {
        ...base,
        candidateId,
        stage: original.stage,
        err: errorMessage(original.cause ?? original),
        rollbackErr: errorMessage(rollbackError),
      },
      "replacement_rollback_failed",
    );
    throw new ObjectReplacementError(
      "candidate_rollback",
      `Could not roll back candidate ${candidateId} after ${original.stage} failed for ${base.bucket}/${base.key}.`,
      { cause: original },
    );
  }
  throw original;
}

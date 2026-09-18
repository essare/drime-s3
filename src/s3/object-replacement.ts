import { DrimeApiError, isInvalidEntryIdsError } from "../drime/client";
import { parseCreatedFileEntry } from "../drime/created-entry";
import type { FileEntry } from "../drime/types";
import type { AppContext } from "../server-context";
import { buildObjectDescription } from "./tagging";

/**
 * Delays between the fresh listings that confirm what an errored old-entry
 * deletion actually did upstream. Five polls, four waits.
 */
const STALE_DELETE_CONFIRM_DELAYS_MS = [250, 500, 1000, 2000];

const MAX_LOGGED_ERROR_CHARS = 200;

/** Plain MD5, or the AWS composite `md5-of-md5s` plus a positive part count. */
const PUBLIC_ETAG_PATTERN = /^[a-f0-9]{32}(-[1-9]\d*)?$/;

/** @internal Test-only confirmation poll seam. */
export type StaleDeleteConfirmOptions = {
  /**
   * @internal Defaults to real timers so production keeps the exact
   * {@link STALE_DELETE_CONFIRM_DELAYS_MS} waits.
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
  /** Public S3 ETag, quoted or bare: MD5 hex, or `md5hex-partCount`. */
  publicEtag: string;
  /** Raw `x-amz-tagging` header value, if any. */
  tagging: string | null;
  /** @internal */
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

/**
 * What five fresh listings could establish about an errored deletion:
 * - `committed`: the candidate is listed and the old entry is gone;
 * - `old_present`: the final listing still shows the old entry;
 * - `unknown`: nothing decisive — the state is ambiguous.
 */
type DeleteConfirmation =
  | { state: "committed" }
  | { state: "old_present" }
  | { state: "unknown"; listErr?: string };

/**
 * Upstream errors are never reused as an `Error.cause`, because Pino's default
 * error serializer walks the `cause` chain and prints every message and stack:
 * a `DrimeApiError` would republish its response-body preview into the log.
 * `DrimeApiError` bodies are therefore dropped entirely (status only). Every
 * other message is whitespace-collapsed and truncated to
 * {@link MAX_LOGGED_ERROR_CHARS}, which bounds — but cannot by itself remove —
 * upstream text that the throwing code already embedded in its own message.
 */
function sanitizeUpstreamError(error: unknown): Error {
  if (error instanceof DrimeApiError) {
    return new Error(`Drime API error ${error.status} (response body omitted)`);
  }
  const raw = error instanceof Error ? error.message : String(error);
  return new Error(
    raw.replace(/\s+/g, " ").trim().slice(0, MAX_LOGGED_ERROR_CHARS),
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Commit a create-first object replacement: persist the public ETag on the
 * already-created candidate, delete the old entry, then publish one
 * authoritative cache replacement. The old entry stays readable until its
 * metadata-bearing candidate is fully persisted.
 *
 * Every failure resolves in favour of data preservation. The candidate is
 * rolled back only while the old entry is known to exist; when an errored
 * deletion cannot be resolved into a known state, both versions are kept and
 * the caller gets an `old_delete` error, because a duplicate is recoverable and
 * a double delete is not.
 */
export async function commitObjectReplacement(
  ctx: AppContext,
  opts: CommitObjectReplacementOptions,
): Promise<FileEntry> {
  const etag = opts.publicEtag
    .trim()
    .replace(/^"+|"+$/g, "")
    .toLowerCase();
  const description = buildObjectDescription(etag, opts.tagging);
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
    const sanitized = sanitizeUpstreamError(error);
    ctx.logger.error({ ...base, err: sanitized.message }, "orphan_candidate");
    throw new ObjectReplacementError(
      "candidate_parse",
      `Could not identify the created entry for ${opts.bucket}/${opts.key}.`,
      { cause: sanitized },
    );
  }

  const candidateId = candidate.id;
  ctx.logger.info({ ...base, candidateId }, "candidate_registered");

  if (!PUBLIC_ETAG_PATTERN.test(etag)) {
    /** Persisting a malformed ETag would make every later HEAD/GET disagree. */
    const sanitized = new Error(
      `Public ETag ${JSON.stringify(etag.slice(0, 64))} is neither an MD5 nor a composite ETag.`,
    );
    ctx.logger.error(
      { ...base, candidateId, err: sanitized.message },
      "etag_persist_failed",
    );
    return await rollbackCandidate(
      ctx,
      base,
      candidateId,
      new ObjectReplacementError(
        "etag_persist",
        `Refusing to persist a malformed ETag for ${opts.bucket}/${opts.key}.`,
        { cause: sanitized },
      ),
    );
  }

  try {
    await ctx.drime.updateFileEntryDescription(candidateId, description);
  } catch (error) {
    const sanitized = sanitizeUpstreamError(error);
    ctx.logger.error(
      { ...base, candidateId, err: sanitized.message },
      "etag_persist_failed",
    );
    return await rollbackCandidate(
      ctx,
      base,
      candidateId,
      new ObjectReplacementError(
        "etag_persist",
        `Could not persist the ETag for ${opts.bucket}/${opts.key}.`,
        { cause: sanitized },
      ),
    );
  }

  if (oldEntryId !== undefined) {
    try {
      await ctx.drime.deleteEntriesForever([oldEntryId]);
    } catch (error) {
      const sanitized = sanitizeUpstreamError(error);
      const confirmation = await confirmDeletion(
        ctx,
        opts,
        oldEntryId,
        candidateId,
      );
      const fields = {
        ...base,
        candidateId,
        invalidEntryIds: isInvalidEntryIdsError(error),
        confirmation: confirmation.state,
        err: sanitized.message,
        ...(confirmation.state === "unknown" && confirmation.listErr
          ? { confirmErr: confirmation.listErr }
          : {}),
      };

      if (confirmation.state === "committed") {
        /** The delete did apply; only its response was lost. */
        ctx.logger.warn(fields, "old_delete_failed");
      } else if (confirmation.state === "old_present") {
        ctx.logger.error(fields, "old_delete_failed");
        return await rollbackCandidate(
          ctx,
          base,
          candidateId,
          new ObjectReplacementError(
            "old_delete",
            `Could not delete the replaced entry ${oldEntryId} for ${opts.bucket}/${opts.key}.`,
            { cause: sanitized },
          ),
        );
      } else {
        /**
         * Ambiguous: the old entry may already be gone, so deleting the
         * candidate could destroy both versions. Keep both and report.
         */
        ctx.logger.error(fields, "old_delete_failed");
        ctx.logger.error(
          { ...fields, candidateRetained: true },
          "replacement_ambiguous_data_preserved",
        );
        throw new ObjectReplacementError(
          "old_delete",
          `Deletion of the replaced entry ${oldEntryId} for ${opts.bucket}/${opts.key} could not be confirmed; candidate ${candidateId} was kept.`,
          { cause: sanitized },
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
 * Resolve an errored old-entry deletion through fresh, uncached listings —
 * never `ListTtlCache`, whose replacement overlays would hide the very rows
 * being checked.
 *
 * A commit needs positive proof of both halves of the replacement: the
 * candidate listed and the old entry gone. Only the final poll decides
 * `old_present`, so a stale listing early in the window cannot trigger a
 * rollback that would race a deletion Drime has in fact already applied.
 */
async function confirmDeletion(
  ctx: AppContext,
  opts: CommitObjectReplacementOptions,
  oldEntryId: number,
  candidateId: number,
): Promise<DeleteConfirmation> {
  const sleep = opts.staleDelete?.sleep ?? defaultSleep;
  let lastSeen: { oldPresent: boolean } | undefined;
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
      const oldPresent = rows.some((row) => row.id === oldEntryId);
      const candidatePresent = rows.some((row) => row.id === candidateId);
      if (candidatePresent && !oldPresent) return { state: "committed" };
      lastSeen = { oldPresent };
      listErr = undefined;
    } catch (error) {
      lastSeen = undefined;
      listErr = sanitizeUpstreamError(error).message;
    }
  }

  if (lastSeen?.oldPresent) return { state: "old_present" };
  return { state: "unknown", listErr };
}

/**
 * Best-effort candidate cleanup for states where the old object is known to be
 * intact. It never masks why the replacement failed: the original stage error
 * propagates when cleanup succeeds, and becomes the `cause` of a
 * `candidate_rollback` error when cleanup itself fails.
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
    const originalCause = original.cause;
    ctx.logger.error(
      {
        ...base,
        candidateId,
        stage: original.stage,
        err:
          originalCause instanceof Error
            ? originalCause.message
            : original.message,
        rollbackErr: sanitizeUpstreamError(rollbackError).message,
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

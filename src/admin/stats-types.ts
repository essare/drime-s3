export type BucketStat = {
  name: string;
  bytes: number;
  objects: number | null;
};

export type WorkspaceStats = {
  buckets: number;
  totalBytes: number;
  totalObjects: number | null;
  perBucket: BucketStat[];
  /** `metadata` uses Drime folder `file_size` (one list call). `walk` recurses all objects. */
  source: "metadata" | "walk";
};

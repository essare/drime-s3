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
  /** Fast path always uses Drime folder `file_size` from the root listing. */
  source: "metadata";
};

export type BucketObjectCount = {
  name: string;
  objects: number;
};

export type WorkspaceObjectCounts = {
  totalObjects: number;
  perBucket: BucketObjectCount[];
};

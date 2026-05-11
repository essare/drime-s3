export const adminKey = ["admin"] as const;
export const healthKey = ["admin", "health"] as const;
export const sessionKey = ["admin", "session"] as const;
export const statusKey = ["admin", "status"] as const;
export const statsKey = ["admin", "stats"] as const;
export const bucketsKey = ["admin", "buckets"] as const;
export const objectsKey = (
  bucket: string,
  params: { prefix: string; delimiter: string },
) => ["admin", "objects", bucket, params] as const;

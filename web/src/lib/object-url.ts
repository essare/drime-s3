export function buildObjectUrl(bucket: string, key: string): string {
  const segments = key
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `/_admin/buckets/${encodeURIComponent(bucket)}/objects/${segments}`;
}

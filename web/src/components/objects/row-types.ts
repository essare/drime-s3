export type Row =
  | { kind: "folder"; name: string; fullPrefix: string; lastModified: string }
  | {
      kind: "object";
      key: string;
      size: number;
      lastModified: string;
      etag: string;
    };

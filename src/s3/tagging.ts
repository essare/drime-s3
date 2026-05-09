import { XMLBuilder } from "fast-xml-parser";

const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

const tagBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
  suppressEmptyNode: true,
});

function xmlnsAttrs() {
  return { "@_xmlns": S3_XMLNS };
}

const TAG_LINE_PREFIX = "s3tag:";

/** First line may be `md5:…`; optional second line `s3tag:…` (URL-encoded pairs `k=v&…`). */
export function buildObjectDescription(
  md5Hex: string,
  taggingHeader: string | null | undefined,
): string {
  const md5Line = `md5:${md5Hex}`;
  const t = taggingHeader?.trim();
  if (!t) return md5Line;
  return `${md5Line}\n${TAG_LINE_PREFIX}${t}`;
}

export function etagFromEntryDescription(description: string | null): string {
  const first = description?.split("\n")[0]?.trim() ?? "";
  if (first.startsWith("md5:")) {
    return `"${first.slice(4)}"`;
  }
  return '"unknown"';
}

export function parseTaggingLine(description: string | null): string | null {
  if (!description) return null;
  for (const line of description.split("\n")) {
    const t = line.trim();
    if (t.startsWith(TAG_LINE_PREFIX)) {
      return t.slice(TAG_LINE_PREFIX.length);
    }
  }
  return null;
}

/** S3 `GET ?tagging` response. */
export function objectTaggingXml(tagQuery: string | null): string {
  const pairs = new URLSearchParams(tagQuery ?? "");
  const tags: { Key: string; Value: string }[] = [];
  for (const [k, v] of pairs) {
    if (k) tags.push({ Key: k, Value: v });
  }
  const obj = {
    Tagging: {
      ...xmlnsAttrs(),
      TagSet: tags.length === 0 ? {} : { Tag: tags },
    },
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${tagBuilder.build(obj)}`;
}

import { XMLBuilder } from "fast-xml-parser";

const S3_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
});

/** S3 error document (XML body for 4xx/5xx). */
export function s3ErrorXml(code: string, message: string): string {
  const obj = {
    Error: {
      "@_xmlns": S3_XMLNS,
      Code: code,
      Message: message,
    },
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(obj)}`;
}

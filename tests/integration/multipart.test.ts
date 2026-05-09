import { describe, expect, test } from "bun:test";
import { XMLParser } from "fast-xml-parser";
import pino from "pino";
import type { AppConfig } from "../../src/config";
import { dispatch } from "../../src/s3/router";
import { createAppContext } from "../../src/server-context";
import { startMockDrime } from "../fixtures/mock-drime/server";

function testConfig(apiBaseUrl: string): AppConfig {
  return {
    s3: {
      accessKey: "AKIATEST",
      secretKey: "test-secret-test-secret-test-secret",
      region: "drime",
    },
    drime: {
      apiKey: "mock-drime-key",
      apiBaseUrl,
      gatewayWorkspaceName: "drime-s3",
    },
    server: { host: "127.0.0.1", port: 8081 },
    insecure: true,
  };
}

describe("S3 multipart upload", () => {
  test("POST uploads → PUT part → POST complete → GET object", async () => {
    const mock = await startMockDrime({ seedRootFolders: ["mp-bucket"] });
    try {
      const ctx = await createAppContext({
        config: testConfig(mock.baseUrl),
        logger: pino({ level: "silent" }),
      });
      const base = "http://127.0.0.1:8081";
      const h = { Host: "127.0.0.1:8081" };
      const bucket = "mp-bucket";
      const objectKey = "big.bin";
      const partBody = Buffer.from("part-one-bytes", "utf8");

      const init = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}?uploads=`, {
          method: "POST",
          headers: h,
        }),
      );
      expect(init.status).toBe(200);
      const initXml = await init.text();
      expect(initXml).toContain("InitiateMultipartUploadResult");
      const xmlParser = new XMLParser({
        removeNSPrefix: true,
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
      });
      const initDoc = xmlParser.parse(initXml) as Record<string, unknown>;
      const initRoot =
        initDoc.InitiateMultipartUploadResult ??
        initDoc.initiateMultipartUploadResult;
      expect(initRoot && typeof initRoot === "object").toBe(true);
      const uploadId = String(
        (initRoot as Record<string, unknown>).UploadId ?? "",
      );
      expect(uploadId.length).toBeGreaterThan(4);

      const listBefore = await dispatch(
        ctx,
        new Request(
          `${base}/${bucket}/${objectKey}?uploadId=${encodeURIComponent(uploadId)}`,
          { method: "GET", headers: h },
        ),
      );
      expect(listBefore.status).toBe(200);

      const partPut = await dispatch(
        ctx,
        new Request(
          `${base}/${bucket}/${objectKey}?partNumber=1&uploadId=${encodeURIComponent(uploadId)}`,
          {
            method: "PUT",
            headers: {
              ...h,
              "Content-Type": "application/octet-stream",
              "Content-Length": String(partBody.length),
            },
            body: partBody,
          },
        ),
      );
      expect(partPut.status).toBe(200);
      const partEtag =
        partPut.headers.get("etag")?.replace(/^"+|"+$/g, "") ?? "";

      const listAfter = await dispatch(
        ctx,
        new Request(
          `${base}/${bucket}/${objectKey}?uploadId=${encodeURIComponent(uploadId)}`,
          { method: "GET", headers: h },
        ),
      );
      expect(listAfter.status).toBe(200);
      const listXml = await listAfter.text();
      expect(listXml).toContain("<PartNumber>1</PartNumber>");

      const completeBody = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Part>
    <PartNumber>1</PartNumber>
    <ETag>"${partEtag}"</ETag>
  </Part>
</CompleteMultipartUpload>`;

      const complete = await dispatch(
        ctx,
        new Request(
          `${base}/${bucket}/${objectKey}?uploadId=${encodeURIComponent(uploadId)}`,
          {
            method: "POST",
            headers: {
              ...h,
              "Content-Type": "application/xml",
              "Content-Length": String(Buffer.byteLength(completeBody, "utf8")),
            },
            body: completeBody,
          },
        ),
      );
      expect(complete.status).toBe(200);
      const completeXml = await complete.text();
      expect(completeXml).toContain("CompleteMultipartUploadResult");

      const get = await dispatch(
        ctx,
        new Request(`${base}/${bucket}/${objectKey}`, {
          method: "GET",
          headers: h,
        }),
      );
      expect(get.status).toBe(200);
      const buf = Buffer.from(await get.arrayBuffer());
      expect(buf.equals(partBody)).toBe(true);
    } finally {
      mock.stop();
    }
  });
});

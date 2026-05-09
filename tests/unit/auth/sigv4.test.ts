import { describe, expect, test } from "bun:test";
import {
  computeSignatureV4ForTests,
  parseAuthorizationHeaderForTests,
  verifySignatureV4,
} from "../../../src/auth/sigv4";

/** AWS S3 Sig V4 documentation style GET /test.txt (no Range), empty body SHA256. */
const AWS_EXAMPLE = {
  accessKey: "AKIAIOSFODNN7EXAMPLE",
  secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  host: "examplebucket.s3.amazonaws.com",
  date: "20130524T000000Z",
  dateStamp: "20130524",
  region: "us-east-1",
  service: "s3",
  payloadHash:
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  expectedSignature:
    "df548e2ce037944d03f3e68682813b093763996d597cf890ca3d9037fd231eb4",
};

function exampleHeaders(): Headers {
  const h = new Headers();
  h.set("Host", AWS_EXAMPLE.host);
  h.set("x-amz-date", AWS_EXAMPLE.date);
  h.set("x-amz-content-sha256", AWS_EXAMPLE.payloadHash);
  h.set(
    "Authorization",
    [
      `AWS4-HMAC-SHA256 Credential=${AWS_EXAMPLE.accessKey}/${AWS_EXAMPLE.dateStamp}/${AWS_EXAMPLE.region}/${AWS_EXAMPLE.service}/aws4_request`,
      "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
      `Signature=${AWS_EXAMPLE.expectedSignature}`,
    ].join(", "),
  );
  return h;
}

describe("verifySignatureV4", () => {
  test("accepts AWS-published GET /test.txt vector", async () => {
    const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
    const headers = exampleHeaders();
    const ok = await verifySignatureV4(
      new Request(url, { method: "GET", headers }),
      { method: "GET", url, headers },
      { accessKey: AWS_EXAMPLE.accessKey, secretKey: AWS_EXAMPLE.secretKey },
    );
    expect(ok).toBe(true);
  });

  test("rejects wrong secret key", async () => {
    const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
    const headers = exampleHeaders();
    const ok = await verifySignatureV4(
      new Request(url, { method: "GET", headers }),
      { method: "GET", url, headers },
      {
        accessKey: AWS_EXAMPLE.accessKey,
        secretKey: "wrongsecretwrongsecretwrongsecret",
      },
    );
    expect(ok).toBe(false);
  });

  test("rejects wrong access key id", async () => {
    const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
    const headers = exampleHeaders();
    const ok = await verifySignatureV4(
      new Request(url, { method: "GET", headers }),
      { method: "GET", url, headers },
      { accessKey: "AKIAOTHERKEYEXAMPLE", secretKey: AWS_EXAMPLE.secretKey },
    );
    expect(ok).toBe(false);
  });

  test("rejects tampered host header value", async () => {
    const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
    const headers = exampleHeaders();
    headers.set("Host", "evil.example.com");
    const ok = await verifySignatureV4(
      new Request(url, { method: "GET", headers }),
      { method: "GET", url, headers },
      { accessKey: AWS_EXAMPLE.accessKey, secretKey: AWS_EXAMPLE.secretKey },
    );
    expect(ok).toBe(false);
  });

  test("computeSignatureV4ForTests matches published hex", async () => {
    const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
    const headers = exampleHeaders();
    const parsed = parseAuthorizationHeaderForTests(
      headers.get("Authorization"),
    );
    const computed = await computeSignatureV4ForTests(
      { method: "GET", url, headers },
      AWS_EXAMPLE.secretKey,
      parsed,
      AWS_EXAMPLE.payloadHash,
    );
    expect(computed).toBe(AWS_EXAMPLE.expectedSignature);
  });

  test("honors bodySha256 override when x-amz-content-sha256 omitted", async () => {
    const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
    const headers = new Headers();
    headers.set("Host", AWS_EXAMPLE.host);
    headers.set("x-amz-date", AWS_EXAMPLE.date);
    headers.set(
      "Authorization",
      [
        `AWS4-HMAC-SHA256 Credential=${AWS_EXAMPLE.accessKey}/${AWS_EXAMPLE.dateStamp}/${AWS_EXAMPLE.region}/${AWS_EXAMPLE.service}/aws4_request`,
        "SignedHeaders=host;x-amz-date",
        "Signature=0000000000000000000000000000000000000000000000000000000000000000",
      ].join(", "),
    );
    const parsed = parseAuthorizationHeaderForTests(
      headers.get("Authorization"),
    );
    const sig = await computeSignatureV4ForTests(
      { method: "GET", url, headers },
      AWS_EXAMPLE.secretKey,
      parsed,
      AWS_EXAMPLE.payloadHash,
    );
    headers.set(
      "Authorization",
      [
        `AWS4-HMAC-SHA256 Credential=${AWS_EXAMPLE.accessKey}/${AWS_EXAMPLE.dateStamp}/${AWS_EXAMPLE.region}/${AWS_EXAMPLE.service}/aws4_request`,
        "SignedHeaders=host;x-amz-date",
        `Signature=${sig}`,
      ].join(", "),
    );
    const ok = await verifySignatureV4(
      new Request(url, { method: "GET", headers }),
      {
        method: "GET",
        url,
        headers,
        bodySha256: AWS_EXAMPLE.payloadHash,
      },
      { accessKey: AWS_EXAMPLE.accessKey, secretKey: AWS_EXAMPLE.secretKey },
    );
    expect(ok).toBe(true);
  });
});

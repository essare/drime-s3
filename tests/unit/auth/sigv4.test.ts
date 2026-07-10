import { describe, expect, test } from "bun:test";
import {
  canonicalUriPathForTests,
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

  test("accepts UNSIGNED-PAYLOAD for PUT (S3 clients such as Duplicati)", async () => {
    const url = new URL(
      "http://192.168.2.33:38280/duplicati-backups/access-privileges-test.tmp",
    );
    const accessKey = "AKIATESTKEYEXAMPLE";
    const secretKey = "testSecretAccessKey01234567890123456789012";
    const dateStamp = "20260101";
    const amzDate = "20260101T120000Z";
    const region = "drime";
    const svc = "s3";
    const headers = new Headers();
    headers.set("Host", "192.168.2.33:38280");
    headers.set("x-amz-date", amzDate);
    headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");
    headers.set(
      "Authorization",
      [
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${dateStamp}/${region}/${svc}/aws4_request`,
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        "Signature=0000000000000000000000000000000000000000000000000000000000000000",
      ].join(", "),
    );
    const parsed = parseAuthorizationHeaderForTests(
      headers.get("Authorization"),
    );
    const sig = await computeSignatureV4ForTests(
      { method: "PUT", url, headers },
      secretKey,
      parsed,
      "UNSIGNED-PAYLOAD",
    );
    headers.set(
      "Authorization",
      [
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${dateStamp}/${region}/${svc}/aws4_request`,
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        `Signature=${sig}`,
      ].join(", "),
    );
    const ok = await verifySignatureV4(
      new Request(url, { method: "PUT", headers }),
      { method: "PUT", url, headers },
      { accessKey, secretKey },
    );
    expect(ok).toBe(true);
  });
});

describe("canonicalUriPath", () => {
  test("preserves already-encoded percent sequences", () => {
    expect(
      canonicalUriPathForTests(
        "/bucket/folder/2026-06-10T08%3A44%3A32Z/file.blob",
      ),
    ).toBe("/bucket/folder/2026-06-10T08%3A44%3A32Z/file.blob");
  });

  test.each(["%40", "%2B", "%20"])("encodes %s correctly", (encoded) => {
    expect(canonicalUriPathForTests(`/bucket/${encoded}`)).toBe(
      `/bucket/${encoded}`,
    );
  });

  test("encoded slash inside a segment stays in that segment", () => {
    expect(canonicalUriPathForTests("/bucket/a%2Fb")).toBe("/bucket/a%2Fb");
  });

  test("malformed percent encoding falls back to literal re-encoding", () => {
    expect(canonicalUriPathForTests("/bucket/a%ZZb")).toBe("/bucket/a%25ZZb");
  });
});

describe("verifySignatureV4 percent-encoded path regression", () => {
  test("signature computed with raw colons verifies against %3A-encoded URL", async () => {
    const accessKey = "AKIAIOSFODNN7EXAMPLE";
    const secretKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const dateStamp = "20260610";
    const amzDate = "20260610T084432Z";
    const region = "us-east-1";
    const svc = "s3";
    const host = "examplebucket.s3.amazonaws.com";
    const payloadHash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const signUrl = new URL(
      `https://${host}/bucket/folder/2026-06-10T08:44:32Z/file.blob`,
    );
    const signHeaders = new Headers();
    signHeaders.set("Host", host);
    signHeaders.set("x-amz-date", amzDate);
    signHeaders.set("x-amz-content-sha256", payloadHash);
    signHeaders.set(
      "Authorization",
      [
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${dateStamp}/${region}/${svc}/aws4_request`,
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        "Signature=0000000000000000000000000000000000000000000000000000000000000000",
      ].join(", "),
    );

    const parsed = parseAuthorizationHeaderForTests(
      signHeaders.get("Authorization"),
    );
    const sig = await computeSignatureV4ForTests(
      { method: "GET", url: signUrl, headers: signHeaders },
      secretKey,
      parsed,
      payloadHash,
    );

    const verifyUrl = new URL(
      `https://${host}/bucket/folder/2026-06-10T08%3A44%3A32Z/file.blob`,
    );
    const verifyHeaders = new Headers();
    verifyHeaders.set("Host", host);
    verifyHeaders.set("x-amz-date", amzDate);
    verifyHeaders.set("x-amz-content-sha256", payloadHash);
    verifyHeaders.set(
      "Authorization",
      [
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${dateStamp}/${region}/${svc}/aws4_request`,
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        `Signature=${sig}`,
      ].join(", "),
    );

    const ok = await verifySignatureV4(
      new Request(verifyUrl, { method: "GET", headers: verifyHeaders }),
      { method: "GET", url: verifyUrl, headers: verifyHeaders },
      { accessKey, secretKey },
    );
    expect(ok).toBe(true);
  });
});

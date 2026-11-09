import { describe, it, expect, spyOn } from "bun:test";
import {
  S3Client,
  NoSuchKey,
  S3ServiceException,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { test_env } from "@/common/tests/TestManager.test";
import EnvManager from "../../env/EnvManager";
import { ProviderS3 } from "./ProviderS3";

const S3_ENV = {
  ...test_env,
  S3_BUCKET: "bucket",
  S3_REGION: "eu-central-1",
  S3_ACCESS_KEY: "AKIATEST",
  S3_SECRET_KEY: "secret",
  S3_ENDPOINT: undefined,
};

const withEnv = <T>(env: typeof S3_ENV, fn: () => T): T => {
  const spy = spyOn(EnvManager, "get").mockReturnValue(env);
  try {
    return fn();
  } finally {
    spy.mockReturnValue(test_env);
  }
};

/** A real client whose network call (send) is replaced: external I/O only. */
const fakeClient = () =>
  new S3Client({
    region: "eu-central-1",
    credentials: { accessKeyId: "a", secretAccessKey: "b" },
  });

const objectBody = (text: string) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return Object.assign(stream, {
    transformToByteArray: () =>
      Promise.reject(new Error("must not buffer the whole object")),
    transformToString: () =>
      Promise.reject(new Error("must not buffer the whole object")),
    transformToWebStream: () => stream,
  });
};

const s3Error = (name: string, httpStatusCode: number) =>
  new S3ServiceException({
    name,
    $fault: httpStatusCode >= 500 ? "server" : "client",
    $metadata: { httpStatusCode },
    message: name,
  });

const codeOf = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err ? err.code : err;

describe("BUG-18: S3 downloads stream and report errors", () => {
  it("[BUG-18] download returns the object stream with its metadata (no buffering)", async () => {
    const client = fakeClient();
    const body = objectBody("hello");
    const output: GetObjectCommandOutput = {
      $metadata: {},
      Body: body,
      ContentLength: 5,
      ContentType: "text/plain",
      ETag: '"etag-1"',
    };
    spyOn(client, "send").mockImplementation(() => Promise.resolve(output));
    const provider = withEnv(S3_ENV, () => new ProviderS3({ client }));

    const res = await provider.download("tenant/file.txt");

    expect(res?.stream).toBe(body);
    expect(res).toMatchObject({
      contentLength: 5,
      contentType: "text/plain",
      etag: '"etag-1"',
    });
    expect(await new Response(res?.stream).text()).toBe("hello");
  });

  it("[BUG-18] NoSuchKey (or any 404) → null", async () => {
    const client = fakeClient();
    const provider = withEnv(S3_ENV, () => new ProviderS3({ client }));

    spyOn(client, "send").mockImplementation(() =>
      Promise.reject(
        new NoSuchKey({ $metadata: { httpStatusCode: 404 }, message: "gone" }),
      ),
    );
    expect(await provider.download("missing")).toBeNull();

    spyOn(client, "send").mockImplementation(() =>
      Promise.reject(s3Error("NotFound", 404)),
    );
    expect(await provider.download("missing")).toBeNull();
  });

  it("[BUG-18] AccessDenied and other backend errors propagate as 502 (never a fake 404)", async () => {
    const client = fakeClient();
    const provider = withEnv(S3_ENV, () => new ProviderS3({ client }));

    spyOn(client, "send").mockImplementation(() =>
      Promise.reject(s3Error("AccessDenied", 403)),
    );
    const denied = await provider.download("k").then(
      () => "no-throw",
      (e: unknown) => e,
    );
    expect(codeOf(denied)).toBe(502);

    spyOn(client, "send").mockImplementation(() =>
      Promise.reject(new Error("socket hang up")),
    );
    const network = await provider.download("k").then(
      () => "no-throw",
      (e: unknown) => e,
    );
    expect(codeOf(network)).toBe(502);
  });

  it("[BUG-18] path-style addressing is off by default and on with S3_FORCE_PATH_STYLE=true", async () => {
    const virtual = withEnv(
      { ...S3_ENV, S3_FORCE_PATH_STYLE: false },
      () => new ProviderS3(),
    );
    const pathStyle = withEnv(
      { ...S3_ENV, S3_FORCE_PATH_STYLE: true },
      () => new ProviderS3(),
    );

    // Presigning is local (no network) and shows the addressing style.
    const virtualUrl = new URL(await virtual.getDownloadUrl("a/b.png"));
    const pathUrl = new URL(await pathStyle.getDownloadUrl("a/b.png"));

    expect(virtualUrl.hostname).toBe("bucket.s3.eu-central-1.amazonaws.com");
    expect(virtualUrl.pathname).toBe("/a/b.png");
    expect(pathUrl.hostname).toBe("s3.eu-central-1.amazonaws.com");
    expect(pathUrl.pathname).toBe("/bucket/a/b.png");
  });
});

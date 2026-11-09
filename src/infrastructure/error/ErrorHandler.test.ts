import { describe, it, expect } from "bun:test";
import { Elysia, status, t } from "elysia";
import { ErrorHandler } from "./ErrorHandler";
import { UtilHttp } from "@/common/utils/UtilHttp";

/** A driver error as drizzle wraps it: the Postgres code is on `cause`. */
const pgError = (code: string) =>
  new Error("Failed query: insert into ...", {
    cause: Object.assign(new Error("db said no"), { code }),
  });

const app = new Elysia()
  .use(ErrorHandler)
  .post("/validate", ({ body }) => body, {
    body: t.Object({ name: t.String({ minLength: 3 }) }),
  })
  .get("/bare/:code", ({ params }) => {
    throw status(Number(params.code));
  })
  .get("/message", () => {
    throw status("Unauthorized", { message: "Wrong current password" });
  })
  .get("/text", () => {
    throw status(400, "Missing tenant header");
  })
  .get("/fail", () => {
    throw UtilHttp.fail(409, "File is in use", [
      { field: "id", message: "referenced" },
    ]);
  })
  .get("/pg/:code", ({ params }) => {
    throw pgError(params.code);
  })
  .get("/boom", () => {
    throw new Error("secret internal detail");
  })
  .get("/cookie", ({ cookie }) => cookie.session.value, {
    cookie: t.Cookie(
      { session: t.String() },
      { secrets: "cookie-secret", sign: ["session"] },
    ),
  })
  .post("/file", ({ body }) => body.file.size, {
    body: t.Object({ file: t.File({ type: "image/png" }) }),
  });

const req = (method: string, path: string, init: RequestInit = {}) =>
  app.handle(new Request(`http://localhost${path}`, { method, ...init }));

const envelope = async (res: Response) => ({
  status: res.status,
  body: await res.json(),
});

describe("BUG-14: one error envelope { error, message?, details? }", () => {
  it("[BUG-14] validation errors: 400 Bad Request with field details", async () => {
    const res = await req("POST", "/validate", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const { status: code, body } = await envelope(res);
    expect(code).toBe(400);
    expect(body).toMatchObject({
      error: "Bad Request",
      message: "Validation failed",
    });
    expect(body.details).toEqual([expect.objectContaining({ field: "name" })]);
  });

  it("[BUG-14] unknown route: 404 { error: Not Found }", async () => {
    expect(await envelope(await req("GET", "/nowhere"))).toEqual({
      status: 404,
      body: { error: "Not Found" },
    });
  });

  it("[BUG-14] malformed JSON body: 400 with a message", async () => {
    const res = await req("POST", "/validate", {
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(await envelope(res)).toEqual({
      status: 400,
      body: { error: "Bad Request", message: "Malformed request body" },
    });
  });

  it("[BUG-14] a bare status() gets the reason phrase as error", async () => {
    for (const [code, phrase] of [
      [401, "Unauthorized"],
      [403, "Forbidden"],
      [404, "Not Found"],
      [503, "Service Unavailable"],
    ] as const) {
      expect(await envelope(await req("GET", `/bare/${code}`))).toEqual({
        status: code,
        body: { error: phrase },
      });
    }
  });

  it("[BUG-14] status(code, { message }) and status(code, 'text') keep the text as message", async () => {
    expect(await envelope(await req("GET", "/message"))).toEqual({
      status: 401,
      body: { error: "Unauthorized", message: "Wrong current password" },
    });
    expect(await envelope(await req("GET", "/text"))).toEqual({
      status: 400,
      body: { error: "Bad Request", message: "Missing tenant header" },
    });
  });

  it("[BUG-14] UtilHttp.fail builds the envelope", async () => {
    expect(await envelope(await req("GET", "/fail"))).toEqual({
      status: 409,
      body: {
        error: "Conflict",
        message: "File is in use",
        details: [{ field: "id", message: "referenced" }],
      },
    });
  });

  it("[BUG-14] Postgres error codes map to client errors", async () => {
    const expected: Record<string, [number, string, string]> = {
      "23505": [409, "Conflict", "Resource already exists"],
      "23503": [400, "Bad Request", "Related record does not exist"],
      "22P02": [400, "Bad Request", "Invalid value"],
      "22001": [400, "Bad Request", "Value too long"],
      "23502": [400, "Bad Request", "Missing required value"],
      "40001": [409, "Conflict", "Concurrent update, retry the request"],
      "40P01": [409, "Conflict", "Concurrent update, retry the request"],
      "57014": [503, "Service Unavailable", "Query timed out"],
    };
    for (const [pg, [code, error, message]] of Object.entries(expected)) {
      expect(await envelope(await req("GET", `/pg/${pg}`))).toEqual({
        status: code,
        body: { error, message },
      });
    }
  });

  it("[BUG-14] anything else is a 500 without internal details", async () => {
    expect(await envelope(await req("GET", "/boom"))).toEqual({
      status: 500,
      body: { error: "Internal Server Error" },
    });
  });

  it("[BUG-14] an invalid cookie signature: 400 envelope", async () => {
    const res = await req("GET", "/cookie", {
      headers: { cookie: "session=forged.signature" },
    });
    expect(await envelope(res)).toEqual({
      status: 400,
      body: { error: "Bad Request", message: "Invalid cookie signature" },
    });
  });

  it("[BUG-14] a file of the wrong type: 422 envelope", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["plain text"], "a.png", { type: "image/png" }),
    );
    const { status: code, body } = await envelope(
      await req("POST", "/file", { body: form }),
    );
    expect(code).toBe(422);
    expect(body).toMatchObject({ error: "Unprocessable Content" });
    expect(typeof body.message).toBe("string");
  });
});

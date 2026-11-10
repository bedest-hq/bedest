import { describe, it, expect, spyOn } from "bun:test";
import { Elysia } from "elysia";
import { ErrorHandler } from "../error/ErrorHandler";
import { createLogger, logger } from "./logger";

const capture = () => {
  const lines: string[] = [];
  return {
    lines,
    stream: {
      write: (line: string) => {
        lines.push(line);
      },
    },
  };
};

describe("SEC-20: logging", () => {
  it("[SEC-20] an internal error is logged with a non-empty err.message and err.stack", async () => {
    const spy = spyOn(logger, "error").mockImplementation(() => {});
    try {
      const app = new Elysia().use(ErrorHandler).get("/boom", () => {
        throw new Error("kaboom");
      });
      const res = await app.handle(new Request("http://localhost/boom"));
      expect(res.status).toBe(500);
      expect(spy).toHaveBeenCalled();

      // Replay exactly what ErrorHandler logged through a real pino logger.
      const { lines, stream } = capture();
      const sink = createLogger(
        { NODE_ENV: "production", LOG_LEVEL: "info" },
        stream,
      );
      sink.error(...(spy.mock.calls[0] as Parameters<typeof logger.error>));
      const entry = JSON.parse(lines[0] ?? "{}") as {
        err?: { message?: string; stack?: string };
      };
      expect(entry.err?.message).toBe("kaboom");
      expect(entry.err?.stack ?? "").toContain("kaboom");
    } finally {
      spy.mockRestore();
    }
  });

  it("[SEC-20] secrets, cookies and query params are redacted", () => {
    const { lines, stream } = capture();
    const sink = createLogger(
      { NODE_ENV: "production", LOG_LEVEL: "info" },
      stream,
    );
    const dbError = Object.assign(new Error("duplicate key"), {
      params: ["victim@example.com", "$argon2id$hash"],
      cause: { params: ["cause-param-secret"] },
    });
    sink.info(
      {
        req: {
          headers: {
            cookie: "accessToken=abc.def",
            authorization: "Bearer tkn",
          },
        },
        body: { password: "hunter2", currentPassword: "old-pass" },
        auth: {
          token: "t0k3n",
          refreshToken: "r3fr3sh",
          accessToken: "acc3ss",
        },
        err: dbError,
      },
      "something happened",
    );
    const out = lines.join("\n");
    for (const secret of [
      "accessToken=abc.def",
      "Bearer tkn",
      "hunter2",
      "old-pass",
      "t0k3n",
      "r3fr3sh",
      "acc3ss",
      "victim@example.com",
      "$argon2id$hash",
      "cause-param-secret",
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("something happened");
  });

  it("[SEC-20] LOG_LEVEL defaults to silent in test and info otherwise", () => {
    expect(createLogger({ NODE_ENV: "test" }).level).toBe("silent");
    expect(createLogger({ NODE_ENV: "production" }).level).toBe("info");
    expect(
      createLogger({ NODE_ENV: "production", LOG_LEVEL: "warn" }).level,
    ).toBe("warn");
  });
});

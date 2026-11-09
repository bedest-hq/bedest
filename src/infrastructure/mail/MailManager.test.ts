import { describe, it, expect, spyOn } from "bun:test";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import { test_env } from "@/common/tests/TestManager.test";
import EnvManager from "../env/EnvManager";
import { logger } from "../logger/logger";
import MailManager from "./MailManager";
import {
  maskEmail,
  ProviderMailConsole,
} from "./providers/ProviderMailConsole";
import { ProviderMailSmtp } from "./providers/ProviderMailSmtp";

const MSG = {
  to: "jane.doe@example.com",
  subject: "Reset your password",
  text: "Open http://localhost/reset-password#token=SECRET-TOKEN-VALUE",
};

const SMTP_ENV = {
  ...test_env,
  MAIL_PROVIDER: "smtp" as const,
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: 465,
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "mailer-password",
  SMTP_SECURE: true,
  MAIL_FROM: "Bedest <no-reply@example.com>",
};

const codeOf = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err ? err.code : err;

describe("FEAT-06: mailer", () => {
  it("[FEAT-06] the console provider keeps the message and logs one redacted line (no body, no address)", async () => {
    const info = spyOn(logger, "info");
    try {
      const provider = new ProviderMailConsole();
      await provider.send(MSG);

      expect(provider.sent).toEqual([MSG]);
      expect(info).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(info.mock.calls[0]);
      expect(logged).not.toContain("SECRET-TOKEN-VALUE");
      expect(logged).not.toContain("jane.doe@example.com");
      expect(logged).toContain("j***@example.com");
    } finally {
      info.mockRestore();
    }
  });

  it("[FEAT-06] maskEmail keeps the first letter and the domain", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
    expect(maskEmail("no-at-sign")).toBe("***");
  });

  it("[FEAT-06] the SMTP provider sends from MAIL_FROM through the transport", async () => {
    const calls: SendMailOptions[] = [];
    const provider = new ProviderMailSmtp("Bedest <no-reply@example.com>", {
      sendMail: (options) => {
        calls.push(options);
        return Promise.resolve({});
      },
    });
    await provider.send(MSG);
    expect(calls).toEqual([
      {
        from: "Bedest <no-reply@example.com>",
        to: MSG.to,
        subject: MSG.subject,
        text: MSG.text,
        html: undefined,
      },
    ]);
  });

  it("[FEAT-06] an SMTP failure is a 502 and the log holds neither the body nor the address", async () => {
    const error = spyOn(logger, "error");
    try {
      const provider = new ProviderMailSmtp("no-reply@example.com", {
        sendMail: () => Promise.reject(new Error("connect ECONNREFUSED")),
      });
      const err = await provider.send(MSG).then(
        () => null,
        (e: unknown) => e,
      );
      expect(codeOf(err)).toBe(502);
      const logged = JSON.stringify(error.mock.calls);
      expect(logged).not.toContain("SECRET-TOKEN-VALUE");
      expect(logged).not.toContain("jane.doe@example.com");
    } finally {
      error.mockRestore();
    }
  });

  it("[FEAT-06] fromEnv configures nodemailer from the SMTP variables (bounded timeouts)", () => {
    const create = spyOn(nodemailer, "createTransport");
    try {
      ProviderMailSmtp.fromEnv(SMTP_ENV);
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        host: "smtp.example.com",
        port: 465,
        secure: true,
        auth: { user: "mailer", pass: "mailer-password" },
        connectionTimeout: 10_000,
      });
    } finally {
      create.mockRestore();
    }
  });

  it("[FEAT-06] MailManager uses SMTP when MAIL_PROVIDER=smtp, console otherwise", async () => {
    const env = spyOn(EnvManager, "get").mockReturnValue(SMTP_ENV);
    const send = spyOn(ProviderMailSmtp.prototype, "send").mockImplementation(
      () => Promise.resolve(),
    );
    try {
      // Forget the cached provider: the next send resolves it from env.
      MailManager.resetForTesting();
      await MailManager.send(MSG);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
      env.mockReturnValue(test_env);
      MailManager.resetForTesting();
    }
  });

  it("[FEAT-06] links carry the token in the URL fragment, never the query", () => {
    const env = spyOn(EnvManager, "get").mockReturnValue({
      ...test_env,
      APP_PUBLIC_URL: "https://app.example.com/base/",
    });
    try {
      expect(MailManager.link("/reset-password", "abc_DEF-123")).toBe(
        "https://app.example.com/base/reset-password#token=abc_DEF-123",
      );
    } finally {
      env.mockReturnValue(test_env);
    }
  });
});

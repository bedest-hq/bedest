import nodemailer from "nodemailer";
import { UtilHttp } from "@/common/utils/UtilHttp";
import type { SendMailOptions } from "nodemailer";
import type { TEnv } from "@/common/types/TEnv";
import { logger } from "../../logger/logger";
import type { IMailMessage, IMailProvider } from "../interfaces/IMailProvider";
import { maskEmail } from "./ProviderMailConsole";

/** The part of a nodemailer transport the provider uses (mockable). */
export interface ISmtpTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
}

export type TSmtpEnv = Pick<
  TEnv,
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USER"
  | "SMTP_PASSWORD"
  | "SMTP_SECURE"
  | "MAIL_FROM"
>;

/** SMTP mailer (nodemailer) [FEAT-06]. */
export class ProviderMailSmtp implements IMailProvider {
  constructor(
    private readonly from: string,
    private readonly transport: ISmtpTransport,
  ) {}

  /**
   * Built from the environment; EnvManager has already checked that every
   * SMTP variable is set when MAIL_PROVIDER=smtp.
   */
  static fromEnv(env: TSmtpEnv): ProviderMailSmtp {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM } = env;
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) {
      throw new Error("SMTP_* variables are required when MAIL_PROVIDER=smtp");
    }
    if (!MAIL_FROM) {
      throw new Error("MAIL_FROM is required when MAIL_PROVIDER=smtp");
    }
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      // Bounded waits: invitations are sent inside a transaction.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return new ProviderMailSmtp(MAIL_FROM, transport);
  }

  async send(msg: IMailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
    } catch (err) {
      // The body (one-time link) is never logged.
      logger.error(
        { err, to: maskEmail(msg.to), subject: msg.subject },
        "[mail:smtp] sending failed",
      );
      throw UtilHttp.fail(502, "E-mail could not be sent");
    }
  }
}

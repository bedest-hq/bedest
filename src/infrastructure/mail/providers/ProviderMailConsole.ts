import { logger } from "../../logger/logger";
import type { IMailMessage, IMailProvider } from "../interfaces/IMailProvider";

/** Messages kept in memory; older ones are dropped. */
const KEEP_LAST = 100;

/** `jane.doe@example.com` → `j***@example.com` (logs never hold the address). */
export const maskEmail = (address: string): string => {
  const at = address.lastIndexOf("@");
  if (at <= 0) {
    return "***";
  }
  return `${address[0]}***${address.slice(at)}`;
};

/**
 * Development and test mailer [FEAT-06]: nothing is delivered. Each
 * message is logged as one redacted line (masked recipient and subject —
 * never the body, which holds the one-time link) and kept in memory so
 * tests can read it. Refused at boot when NODE_ENV=production.
 */
export class ProviderMailConsole implements IMailProvider {
  readonly sent: IMailMessage[] = [];

  send(msg: IMailMessage): Promise<void> {
    this.sent.push(msg);
    if (this.sent.length > KEEP_LAST) {
      this.sent.shift();
    }
    logger.info(
      { to: maskEmail(msg.to), subject: msg.subject },
      "[mail:console] e-mail not delivered (MAIL_PROVIDER=console)",
    );
    return Promise.resolve();
  }
}

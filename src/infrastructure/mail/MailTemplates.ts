import type { IMailMessage } from "./interfaces/IMailProvider";

/** Plain-text e-mails of the account flows [FEAT-06]. */
export class MailTemplates {
  static passwordReset(to: string, link: string, ttlMinutes: number) {
    const msg: IMailMessage = {
      to,
      subject: "Reset your password",
      text: [
        "Someone asked to reset the password of your account.",
        "",
        `Choose a new password here (valid for ${ttlMinutes} minutes, once):`,
        link,
        "",
        "If this was not you, ignore this e-mail; your password stays the same.",
      ].join("\n"),
    };
    return msg;
  }

  static invitation(to: string, link: string, ttlDays: number) {
    const msg: IMailMessage = {
      to,
      subject: "You have been invited",
      text: [
        "You have been invited to create an account.",
        "",
        `Accept the invitation here (valid for ${ttlDays} days, once):`,
        link,
        "",
        "If you did not expect this invitation, ignore this e-mail.",
      ].join("\n"),
    };
    return msg;
  }
}

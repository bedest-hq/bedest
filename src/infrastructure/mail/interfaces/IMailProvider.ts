/** One outgoing e-mail [FEAT-06]. */
export interface IMailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface IMailProvider {
  /** Throws when the message could not be handed to the mail system. */
  send(msg: IMailMessage): Promise<void>;
}

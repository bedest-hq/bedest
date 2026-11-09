import EnvManager from "../env/EnvManager";
import type { IMailMessage, IMailProvider } from "./interfaces/IMailProvider";
import { ProviderMailConsole } from "./providers/ProviderMailConsole";
import { ProviderMailSmtp } from "./providers/ProviderMailSmtp";

/**
 * Outgoing e-mail [FEAT-06]. The provider is chosen from MAIL_PROVIDER on
 * first use (never at import) and can be swapped in tests.
 */
class MailManager {
  private resolved: IMailProvider | undefined;

  private get provider(): IMailProvider {
    if (!this.resolved) {
      const env = EnvManager.get();
      this.resolved =
        env.MAIL_PROVIDER === "smtp"
          ? ProviderMailSmtp.fromEnv(env)
          : new ProviderMailConsole();
    }
    return this.resolved;
  }

  async send(msg: IMailMessage): Promise<void> {
    await this.provider.send(msg);
  }

  /**
   * A link into the web app for a one-time token. The token travels in the
   * URL fragment, which browsers never send to servers (no access logs, no
   * Referer).
   */
  link(path: string, token: string): string {
    const base = EnvManager.get().APP_PUBLIC_URL.replace(/\/+$/, "");
    return `${base}${path}#token=${encodeURIComponent(token)}`;
  }

  /** Test hook: swap the provider; returns a function restoring the old one. */
  useProviderForTesting(provider: IMailProvider) {
    const previous = this.resolved;
    this.resolved = provider;
    return () => {
      this.resolved = previous;
    };
  }

  /** Test hook: forget the provider; the next send resolves it from env. */
  resetForTesting() {
    this.resolved = undefined;
  }
}

export default new MailManager();

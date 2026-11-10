import { t } from "elysia";

/** A password being set (create, change) [SEC-23]: 12 to 128 characters. */
export const VPassword = t.String({ minLength: 12, maxLength: 128 });

/**
 * A password being checked (login, current password) [SEC-23] accepts any length
 * up to 128, so accounts created under the old 6-character rule still work.
 */
export const VPasswordCheck = t.String({ minLength: 1, maxLength: 128 });

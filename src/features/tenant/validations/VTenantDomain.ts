import { t } from "elysia";

const LABEL = /[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?/.source;

/**
 * A DNS hostname: dot-separated labels of 1-63 letters, digits or inner
 * hyphens, at most 255 characters in total [SEC-25].
 */
export const VTenantDomain = t.String({
  maxLength: 255,
  pattern: `^${LABEL}(?:\\.${LABEL})*$`,
});

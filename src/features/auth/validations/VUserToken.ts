import { t } from "elysia";

/** A raw one-time account token: 32 bytes, base64url [FEAT-06]. */
export const VUserToken = t.String({
  minLength: 43,
  maxLength: 43,
  pattern: "^[A-Za-z0-9_-]{43}$",
});

/**
 * The README example, typechecked by `bun run typecheck` [QLT-06].
 */
import { createBedestClient } from "./index";

// Browsers send the HttpOnly auth cookies themselves; they only need to be
// allowed on cross-origin requests.
const client = createBedestClient("https://api.example.com", {
  fetch: { credentials: "include" },
});

export const loadProfile = async () => {
  const login = await client.api.v1.auth.login.post({
    email: "user@example.com",
    password: "a-long-enough-password",
  });
  if (login.error) {
    // { error, message?, details? } (IApiError) [BUG-14]
    return null;
  }
  const me = await client.api.v1.user.self.get();
  return me.data;
};

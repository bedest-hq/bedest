# @bedest/client

Type-only Eden Treaty client for the Bedest API. It is **hand-maintained and has no generator**: it imports `type App` from `src/app/App.ts`, so every route change is reflected in the client types automatically, and `bun run typecheck` checks it together with the server [QLT-06].

## Usage

```ts
import { createBedestClient } from "./client";

// Browsers send the HttpOnly auth cookies themselves; allow them on
// cross-origin requests. Never set a `cookie` header (browsers forbid it).
const client = createBedestClient("https://api.example.com", {
  fetch: { credentials: "include" },
});

const login = await client.api.v1.auth.login.post({
  email: "user@example.com",
  password: "a-long-enough-password",
});
if (login.error) {
  // login.error.value is { error, message?, details? } (IApiError)
}

const me = await client.api.v1.user.self.get();
```

The same code lives in `client/example.ts`, which the typecheck compiles. Server-side callers (tests, scripts) can pass a custom `fetcher` in the options instead.

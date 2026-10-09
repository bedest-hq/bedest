# @bedest/client

Auto-generated type-safe SDK for Bedest API powered by Elysia Eden Treaty.

## Usage

```ts
import { createBedestClient } from "./client";

const client = createBedestClient("http://localhost:3000");

// Fully typed endpoints:
const res = await client.api.v1.tenant.self.get({
  headers: {
    cookie: "accessToken=...",
  },
});
```

import { describe, it, expect } from "bun:test";
import Context from "./Context";

describe("Context", () => {
  it("[SEC-19] exposes no unvalidated x-tenant-id context", () => {
    expect("Tenant" in Context).toBe(false);
  });
});

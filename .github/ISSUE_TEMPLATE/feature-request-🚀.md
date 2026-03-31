---
name: "Feature request \U0001F680"
about: Suggest an idea or enhancement for the Bedest Boilerplate
title: ''
labels: enhancement
assignees: ''

---

**Is your feature request related to a problem?**
A clear and concise description of the limitation. Ex: "The current `ServiceBaseTenant` does not support soft-delete restoration," or "We need a standard way to handle file uploads within the `IUserApp` context."

**Describe the proposed solution**
How should this be integrated into the existing architecture? 
- Does it require a new `common/services` base class?
- Should it be a new Elysia macro (like `RoleGuard`)?
- Does it involve changes to the `UtilTenantScope`?

**Describe alternatives you've considered**
Any workarounds or different library choices you've explored. Why is the proposed way the most "Bedest-native" approach?

**Proposed Implementation (Optional)**
Provide a brief TypeScript snippet showing the service method or router logic. Please ensure it follows the `(c: IUserApp, ...)` or `(c: IApp, ...)` context pattern.

```typescript
// Example Implementation
async restore(c: TContext, id: TId): Promise<{ success: boolean }> {
  // Proposed logic here
}
```
**Additional context**
Additional Context
Add database schema requirements, specific SaaS use cases, or impact on multi-tenancy/RLS. How does this benefit the Bedest ecosystem?

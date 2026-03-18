---
name: "Feature request \U0001F680"
about: Suggest an idea or enhancement for the Bedest Boilerplate
title: ''
labels: enhancement
assignees: ''

---

**Is your feature request related to a problem? Please describe.**
A clear and concise description of what the problem is. Ex. "I'm always frustrated when I need to implement complex Role-Based Access Control (RBAC) beyond the standard roles..." or "The current architecture lacks built-in Redis caching for high-traffic API routes..."

**Describe the solution you'd like**
A clear and concise description of what you want to happen. How would this look in the architecture? (e.g., "Add a new `ServiceCache` that seamlessly integrates with the `ServiceBaseTenant`", or "Include a pre-configured Elysia rate-limiting plugin tied to the `ETenantPlan`").

**Describe alternatives you've considered**
A clear and concise description of any alternative solutions or features you've considered. Have you tried extending `ServiceBase` yourself or writing a custom Elysia macro to solve this?

**Proposed API or Code Snippet (Optional but helpful)**
If you have an implementation in mind, provide a rough idea of how the service method or Elysia router would look:
```typescript
// Example:
async invalidateTenantCache(c: IUserApp, key: string) {
  // Your proposed logic here
}
```

**Additional context**
Add any other context, database schema diagrams, or specific use cases about the feature request here. Why would this benefit other SaaS projects built on top of Bedest?
```

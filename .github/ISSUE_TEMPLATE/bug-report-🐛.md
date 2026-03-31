---
name: "Bug report \U0001F41B"
about: Create a report to help us improve Bedest Architecture
title: "BUG \U0001F41B"
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of the issue. (e.g., "Recursive error extractor failing to identify unique constraint violation on PostgreSQL.")

**To Reproduce**
Steps to reproduce the behavior:
1. Authenticate to obtain the `accessToken` cookie.
2. Call the targeted endpoint (e.g., `POST /api/v1/example`).
3. Provide the specific payload that triggers the issue:
```json
{
  "exampleColumn": "value"
}
```
4. Observe the response status and the terminal output.

**Expected behavior**
A clear description of the expected outcome. (e.g., "The API should return a 409 Conflict via ErrorHandler, but it returns 500 Internal Server Error instead.")

**Actual behavior / Error Logs**
Please paste the full terminal log (especially the 🔥 System Crash or Failed query logs) or the exact JSON response.

```text
(Paste your logs here)
```

**Environment (please complete the following information):**
 - **OS:** [e.g. macOS Sonoma, Ubuntu 22.04, Windows 11]
 - **Bun Version:** [e.g. 1.1.x] (Run `bun -v`)
 - **Database:** [e.g. PGlite (default) or Standalone PostgreSQL v15]
 - **Elysia Version:** [e.g. 1.0.x]

**Additional context**
Add any other details here. (e.g., "I've customized the UtilTenantScope," or "This only happens when using ServiceBaseTenant inside a transaction.")

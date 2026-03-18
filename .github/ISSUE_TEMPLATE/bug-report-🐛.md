---
name: "Bug report \U0001F41B"
about: Create a report to help us improve Bedest Architecture
title: "BUG \U0001F41B"
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is. (e.g., "Tenant isolation is failing on ServiceExample update method.")

**To Reproduce**
Steps to reproduce the behavior (Please provide API requests if possible):
1. Send a `POST` request to `/api/v1/auth/login` to get the tokens.
2. Send a `GET` request to `/api/v1/example` with the following payload:
```json
{
  "exampleColumn": "test"
}
```
3. Look at the terminal logs or the API response.
4. See error.

**Expected behavior**
A clear and concise description of what you expected to happen. (e.g., "The API should return a 200 OK with the inserted record ID, but it returns 500 Internal Server Error.")

**Actual behavior / Error Logs**
Paste the error stack trace from your terminal or the exact JSON error response from Elysia.

```text
(Paste your logs here)
```

**Environment (please complete the following information):**
 - **OS:** [e.g. macOS Sonoma, Ubuntu 22.04, Windows 11]
 - **Bun Version:** [e.g. 1.1.x] (Run `bun -v`)
 - **Database:** [e.g. PGlite (default) or Standalone PostgreSQL v15]
 - **Elysia Version:** [e.g. 1.0.x]

**Additional context**
Add any other context about the problem here. (Did you modify the `ServiceBaseTenant`? Are you bypassing RLS manually?)
```

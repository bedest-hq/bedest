import { describe, it, expect } from "bun:test";
import { treaty } from "@elysiajs/eden";
import { desc, eq } from "drizzle-orm";
import { createTestUser, test_db } from "@/common/tests/TestManager.test";
import { RouterUser } from "@f/user/routers/RouterUser";
import { EUserRole } from "@f/user/enums/EUserRole";
import { SSystemLog } from "../schemas/SSystemLog";

const api = treaty(RouterUser);

// The audit row is written after the response is sent; poll briefly for it.
const newestAuditRow = async (userId: string) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [row] = await test_db
      .select({ payload: SSystemLog.payload })
      .from(SSystemLog)
      .where(eq(SSystemLog.userId, userId))
      .orderBy(desc(SSystemLog.createdAt))
      .limit(1);
    if (row) {
      return row;
    }
    await Bun.sleep(10);
  }
  return undefined;
};

describe("PluginAudit", () => {
  it("[SEC-06] a user changing their own password leaves no plaintext password in the audit row", async () => {
    const { user, headers } = await createTestUser(EUserRole.USER);
    const newPassword = "brand-new-password-123";

    const res = await api.user({ id: user.id }).put(
      { currentPassword: "test_password", password: newPassword },
      { headers },
    );
    expect(res.status).toBe(200);

    const row = await newestAuditRow(user.id);
    expect(row).toBeDefined();
    const payload = row?.payload ?? {};
    const stored = JSON.stringify(payload);
    expect(stored).not.toContain("test_password");
    expect(stored).not.toContain(newPassword);
    expect(payload.currentPassword).toBe("********");
    expect(payload.password).toBe("********");
  });
});

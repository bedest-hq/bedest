import { EUserRole } from "../enums/EUserRole";
import { SUser } from "../schemas/SUser";
import { status } from "elysia";
import { eq, and } from "drizzle-orm";
import { IUserApp, ServiceBaseTenant, UtilTenantScope } from "bedest-core";

class ServiceUser extends ServiceBaseTenant<typeof SUser, string> {
  constructor() {
    super(SUser);
  }

  async create(
    c: IUserApp,
    data: {
      name: string;
      email: string;
      password: string;
      role: EUserRole;
      avatarId?: string;
    },
  ) {
    const hash = await Bun.password.hash(data.password);

    const userR = c.session.role;
    const targetR = data.role;

    if (targetR === EUserRole.SYSTEM && userR !== EUserRole.SYSTEM) {
      throw status("Forbidden");
    }

    if (
      targetR === EUserRole.ADMIN &&
      userR !== EUserRole.ADMIN &&
      userR !== EUserRole.SYSTEM
    ) {
      throw status("Forbidden");
    }

    return super.create(c, {
      ...data,
      password: hash,
    });
  }

  async getAll(c: IUserApp, query: { limit: number; page: number }) {
    return super.getAll(c, query, {
      id: SUser.id,
      tenantId: SUser.tenantId,
      name: SUser.name,
      role: SUser.role,
      avatarId: SUser.avatarId,
      createdAt: SUser.createdAt,
    });
  }

  async getById(c: IUserApp, id: string) {
    return super.getById(c, id, {
      name: SUser.name,
      role: SUser.role,
      email: SUser.email,
      avatarId: SUser.avatarId,
      createdAt: SUser.createdAt,
    });
  }

  async update(
    c: IUserApp,
    id: string,
    data: {
      name?: string;
      password?: string;
      currentPassword?: string;
      avatarId?: string;
    },
  ) {
    const isSelf = c.session.userId === id;
    const isPrivileged = [EUserRole.ADMIN, EUserRole.SYSTEM].includes(
      c.session.role as EUserRole, // FIXME with a better usage.
    );

    if (!isSelf && !isPrivileged) {
      throw status("Forbidden");
    }

    if (data.password) {
      if (!isPrivileged) {
        if (!data.currentPassword) {
          throw status("Bad Request", {
            message: "currentPassword is required to change your password",
          });
        }

        const existing = await UtilTenantScope.tenantScope(c, async (tx) => {
          const [row] = await tx
            .select({ password: SUser.password })
            .from(SUser)
            .where(and(eq(SUser.id, id), eq(SUser.isDeleted, false)))
            .limit(1);
          return row;
        });

        if (!existing) {
          throw status("Not Found");
        }

        const valid = await Bun.password.verify(
          data.currentPassword,
          existing.password,
        );

        if (!valid) {
          throw status("Unauthorized", { message: "Wrong current password" });
        }
      }
    }

    const payload: Partial<typeof SUser.$inferInsert> = {};

    if (data.name) {
      payload.name = data.name;
    }
    if (data.password) {
      payload.password = await Bun.password.hash(data.password);
    }
    if (data.avatarId) {
      payload.avatarId = data.avatarId;
    }

    await super.update(c, id, payload);

    return { success: true };
  }
}

export default new ServiceUser();

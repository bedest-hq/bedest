import { EUserRole } from "../enums/EUserRole";
import { IUserApp } from "../../../common/interfaces/IContextApp";
import { SUser } from "../schemas/SUser";
import { ServiceBase } from "../../../common/services/ServiceBase";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

class ServiceUser extends ServiceBase<typeof SUser, string> {
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
    },
  ) {
    const hash = await Bun.password.hash(data.password);

    const userR = c.session.role;
    const targetR = data.role;

    if (targetR === EUserRole.SYSTEM && userR !== EUserRole.SYSTEM) {
      throw ErrorHandler.forbidden(
        "You are not authorized to create a system user",
      );
    }

    if (
      targetR === EUserRole.ADMIN &&
      userR !== EUserRole.ADMIN &&
      userR !== EUserRole.SYSTEM
    ) {
      throw ErrorHandler.forbidden(
        "You are not authorized to create an admin user",
      );
    }

    return super.create(c, {
      ...data,
      password: hash,
    });
  }

  async getAll(c: IUserApp, query: { limit: number; page: number }) {
    return super.getAll(c, query, {
      name: SUser.name,
      role: SUser.role,
      createdAt: SUser.createdAt,
    });
  }

  async getById(c: IUserApp, id: string) {
    return super.getById(c, id, {
      name: SUser.name,
      role: SUser.role,
      createdAt: SUser.createdAt,
    });
  }

  async update(
    c: IUserApp,
    id: string,
    data: { name?: string; password?: string },
  ) {
    const targetId = [EUserRole.ADMIN, EUserRole.SYSTEM].includes(
      c.session.role,
    )
      ? id
      : c.session.userId;

    const payload: Partial<typeof SUser.$inferInsert> = {};

    if (data.name) {
      payload.name = data.name;
    }
    if (data.password) {
      payload.password = await Bun.password.hash(data.password);
    }

    await super.update(c, targetId, payload);
  }
}

export default new ServiceUser();

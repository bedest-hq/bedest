import { EUserRole } from "../enums/EUserRole";
import { IUserApp } from "../../../common/interfaces/IContextApp";
import { TbUser } from "../tables/TbUser";
import { ServiceBase } from "../../base/services/ServiceBase";

class ServiceUser extends ServiceBase<typeof TbUser, string> {
  constructor() {
    super(TbUser);
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

    return super.create(c, {
      ...data,
      password: hash,
    });
  }

  async getAll(c: IUserApp) {
    return super.getAll(c, {
      name: TbUser.name,
      role: TbUser.role,
      createdAt: TbUser.createdAt,
    });
  }

  async getById(c: IUserApp, id: string) {
    return super.getById(c, id, {
      name: TbUser.name,
      role: TbUser.role,
      createdAt: TbUser.createdAt,
    });
  }

  async update(
    c: IUserApp,
    id: string,
    data: { name?: string; password?: string },
  ) {
    const targetId = c.session.role !== EUserRole.ADMIN ? c.session.userId : id;

    const payload: Partial<typeof TbUser.$inferInsert> = {};

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

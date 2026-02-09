import { and, eq, SQL } from "drizzle-orm";
import { EUserRole } from "../enums/EUserRole";
import { IUserApp } from "../../../common/interfaces/IContextApp";
import { TbUser } from "../tables/TbUser";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

class ServiceUser {
  async create(
    c: IUserApp,
    data: { name: string; email: string; password: string; role: EUserRole },
  ) {
    const hash = await Bun.password.hash(data.password);
    const [user] = await c.db
      .insert(TbUser)
      .values({
        name: data.name,
        password: hash,
        email: data.email,
        role: data.role,
        createdAt: c.nowDatetime,
      })
      .returning({ id: TbUser.id });

    if (!user) {
      ErrorHandler.databaseError("Failed to create user");
    }

    return user;
  }

  async getAll(c: IUserApp) {
    const result = await c.db
      .select({
        name: TbUser.name,
        role: TbUser.role,
        createdAt: TbUser.createdAt,
      })
      .from(TbUser)
      .where(eq(TbUser.isDeleted, false));

    return result;
  }

  async getById(c: IUserApp, id: string) {
    const [result] = await c.db
      .select({
        name: TbUser.name,
        role: TbUser.role,
        createdAt: TbUser.createdAt,
      })
      .from(TbUser)
      .where(and(eq(TbUser.isDeleted, false), eq(TbUser.id, id)));

    if (!result) {
      throw ErrorHandler.notFound("User not found");
    }

    return result;
  }

  async update(
    c: IUserApp,
    data: { userId?: string; name?: string; password?: string },
  ) {
    let hash = undefined;

    // If there is no data to update.
    if (!data.name && !data.password) {
      return;
    }

    if (data.password) {
      hash = await Bun.password.hash(data.password);
    }

    const filter: SQL[] = [];

    // If the user is not an admin or the user id is not provided, filter by the current user's id.
    if (c.session.role !== EUserRole.ADMIN || !data.userId) {
      filter.push(eq(TbUser.id, c.session.userId));
    } else {
      filter.push(eq(TbUser.id, data.userId));
    }

    await c.db
      .update(TbUser)
      .set({ name: data.name, password: hash })
      .where(and(...filter));
  }

  async remove(c: IUserApp, userId: string) {
    await c.db
      .update(TbUser)
      .set({ isDeleted: true })
      .where(eq(TbUser.id, userId));
  }
}

export default new ServiceUser();

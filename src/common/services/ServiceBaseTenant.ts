import { ServiceBase } from "./ServiceBase";
import { IBaseTable } from "../interfaces/IBaseTable";
import { ITenantApp } from "../interfaces/IContextApp";
import { UtilTenantScope } from "../utils/UtilTenantScope";
import { type InferInsertModel } from "drizzle-orm";
import { type SelectedFields, type PgColumn } from "drizzle-orm/pg-core";
import { Prettify } from "elysia/types";

export abstract class ServiceBaseTenant<
  TTable extends IBaseTable & { tenantId: PgColumn },
  TId extends string | number = string,
  TInsertData = Prettify<
    Omit<
      InferInsertModel<TTable>,
      "id" | "tenantId" | "createdAt" | "isDeleted" | "deletedAt"
    >
  >,
> extends ServiceBase<TTable, TId, ITenantApp, TInsertData> {
  async create(c: ITenantApp, data: TInsertData) {
    return await UtilTenantScope.tenantScope(c, async (tx) => {
      const payload = {
        ...(data as object),
        tenantId: c.tenantId,
      } as unknown as Parameters<
        ServiceBase<TTable, TId, ITenantApp, TInsertData>["create"]
      >[1];

      return await super.create({ ...c, db: tx }, payload);
    });
  }

  async update(
    c: ITenantApp,
    id: TId,
    data: Parameters<
      ServiceBase<TTable, TId, ITenantApp, TInsertData>["update"]
    >[2],
  ) {
    return await UtilTenantScope.tenantScope(c, async (tx) =>
      super.update({ ...c, db: tx }, id, data),
    );
  }

  async remove(c: ITenantApp, id: TId) {
    return await UtilTenantScope.tenantScope(c, async (tx) =>
      super.remove({ ...c, db: tx }, id),
    );
  }

  async getById<TSelection extends SelectedFields>(
    c: ITenantApp,
    id: TId,
    columns: TSelection,
  ) {
    return await UtilTenantScope.tenantScope(c, async (tx) =>
      super.getById({ ...c, db: tx }, id, columns),
    );
  }

  async getAll<TSelection extends SelectedFields>(
    c: ITenantApp,
    query: { limit: number; page: number },
    columns: TSelection,
  ) {
    return await UtilTenantScope.tenantScope(c, async (tx) =>
      super.getAll({ ...c, db: tx }, query, columns),
    );
  }
}

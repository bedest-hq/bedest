import { ServiceBase } from "./ServiceBase";
import { IBaseTable } from "../interfaces/IBaseTable";
import { IUserApp } from "../interfaces/IContextApp";
import { UtilDb } from "../utils/UtilDb";
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
> extends ServiceBase<TTable, TId, IUserApp, TInsertData> {
  async create(c: IUserApp, data: TInsertData) {
    return await UtilDb.tenantScope(c, async (tx) => {
      const payload = {
        ...(data as object),
        tenantId: c.tenantId,
      } as unknown as Parameters<
        ServiceBase<TTable, TId, IUserApp, TInsertData>["create"]
      >[1];

      return await super.create({ ...c, db: tx }, payload);
    });
  }

  async update(
    c: IUserApp,
    id: TId,
    data: Parameters<
      ServiceBase<TTable, TId, IUserApp, TInsertData>["update"]
    >[2],
  ) {
    return await UtilDb.tenantScope(c, async (tx) =>
      super.update({ ...c, db: tx }, id, data),
    );
  }

  async remove(c: IUserApp, id: TId) {
    return await UtilDb.tenantScope(c, async (tx) =>
      super.remove({ ...c, db: tx }, id),
    );
  }

  async getById<TSelection extends SelectedFields>(
    c: IUserApp,
    id: TId,
    columns: TSelection,
  ) {
    return await UtilDb.tenantScope(c, async (tx) =>
      super.getById({ ...c, db: tx }, id, columns),
    );
  }

  async getAll<TSelection extends SelectedFields>(
    c: IUserApp,
    query: { limit: number; page: number },
    columns: TSelection,
  ) {
    return await UtilDb.tenantScope(c, async (tx) =>
      super.getAll({ ...c, db: tx }, query, columns),
    );
  }
}

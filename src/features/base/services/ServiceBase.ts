import {
  and,
  eq,
  getTableColumns,
  type SQL,
  type InferInsertModel,
  type InferSelectModel,
} from "drizzle-orm";
import { PgTable, type SelectedFields } from "drizzle-orm/pg-core";
import { type IUserApp } from "../../../common/interfaces/IContextApp";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { type IBaseTable } from "../interfaces/IBaseTable";
import { Prettify } from "elysia/types";
import { UtilDb } from "@/common/utils/UtilDb";

export abstract class ServiceBase<
  TTable extends IBaseTable,
  TId extends string | number = string,
> {
  constructor(protected table: TTable) {}

  protected get columns() {
    return getTableColumns(this.table);
  }

  protected getFilters(id?: TId): SQL[] {
    const filters: SQL[] = [eq(this.table.isDeleted, false)];

    if (id) {
      filters.push(eq(this.table.id, id));
    }

    return filters;
  }

  async create(
    c: IUserApp,
    data: Prettify<Omit<InferInsertModel<TTable>, "tenantId">>,
  ): Promise<{ id: TId }> {
    const payload = {
      ...data,
      tenantId: c.tenantId,
      createdAt: c.nowDatetime,
      isDeleted: false,
    } as InferInsertModel<TTable>;

    const result = await UtilDb.tenantScope(c, async (tx) => {
      const [res] = await tx
        .insert(this.table)
        .values(payload)
        .returning({ id: this.table.id });
      return res;
    });

    if (!result) {
      throw ErrorHandler.internal("Creation failed");
    }

    return result as { id: TId };
  }

  async update(
    c: IUserApp,
    id: TId,
    data: Prettify<Partial<InferInsertModel<TTable>>>,
  ): Promise<void> {
    await UtilDb.tenantScope(c, async (tx) => {
      const update = await tx
        .update(this.table)
        .set(data)
        .where(and(...this.getFilters(id)));

      if (update.rowCount === 0) {
        throw ErrorHandler.notFound("The record not found to update");
      }
    });
  }

  async remove(c: IUserApp, id: TId): Promise<void> {
    const payload = {
      isDeleted: true,
      deletedAt: c.nowDatetime,
    } as unknown as Partial<InferInsertModel<TTable>>;

    await UtilDb.tenantScope(c, async (tx) => {
      await tx
        .update(this.table)
        .set(payload)
        .where(and(...this.getFilters(id)));
    });
  }

  async getAll<TSelection extends SelectedFields>(
    c: IUserApp,
    columns: TSelection,
    limit: number = 100,
    offset: number = 0,
  ): Promise<Prettify<InferSelectModel<TTable>>[]> {
    const result = await UtilDb.tenantScope(c, async (tx) => {
      const query = tx
        .select(columns)
        .from(this.table as PgTable)
        .where(and(...this.getFilters()))
        .$dynamic();

      return query.limit(limit).offset(offset);
    });

    if (!result || result.length === 0) {
      throw ErrorHandler.notFound();
    }

    return result as unknown as Prettify<InferSelectModel<TTable>>[];
  }

  async getById<TSelection extends SelectedFields>(
    c: IUserApp,
    id: TId,
    columns: TSelection,
  ): Promise<Prettify<InferSelectModel<TTable>>> {
    const result = await UtilDb.tenantScope(c, async (tx) => {
      const [res] = await tx
        .select(columns)
        .from(this.table as PgTable)
        .where(and(...this.getFilters(id)));
      return res;
    });

    if (!result) {
      throw ErrorHandler.notFound();
    }

    return result as unknown as Prettify<InferSelectModel<TTable>>;
  }
}

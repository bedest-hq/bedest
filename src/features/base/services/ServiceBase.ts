import { AnyPgTable, SelectedFields } from "drizzle-orm/pg-core";
import { IUserApp } from "../../../common/interfaces/IContextApp";
import { and, eq, Table } from "drizzle-orm";
import { IBaseTable } from "../interfaces/IBaseTable";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";

export class ServiceBase<
  TTable extends AnyPgTable & IBaseTable,
  TId,
  TContext extends IUserApp,
> {
  constructor(table: TTable) {
    this.table = table;
  }
  protected table: TTable;

  protected getFilters(_c: TContext, id?: TId) {
    const filters = [eq(this.table.isDeleted, false)];

    if (id) {
      filters.push(eq(this.table.id, id));
    }

    return filters;
  }

  async create(c: TContext, data: TTable["$inferInsert"]) {
    const [result] = await c.db
      .insert(this.table)
      .values({
        ...data,
        createdAt: c.nowDatetime,
      })
      .returning({ id: this.table.id });

    if (!result) {
      throw ErrorHandler.internal("Creation failed");
    }

    return result.id as string;
  }

  async update(c: TContext, id: TId, data: Partial<TTable["$inferInsert"]>) {
    const update = await c.db
      .update(this.table)
      .set(data)
      .where(and(...this.getFilters(c, id)));

    if (update.rowCount === 0) {
      throw ErrorHandler.notFound("The record not found to update");
    }
  }

  async get<T extends SelectedFields>(c: TContext, columns: T) {
    const result = await c.db
      .select(columns)
      .from(this.table as Table)
      .where(and(...this.getFilters(c)));

    if (!result || result.length === 0) {
      throw ErrorHandler.notFound();
    }
    return result;
  }

  async getById<T extends SelectedFields>(c: TContext, columns: T, id: TId) {
    const [result] = await c.db
      .select(columns)
      .from(this.table as Table)
      .where(and(...this.getFilters(c, id)));

    if (!result) {
      throw ErrorHandler.notFound();
    }

    return result;
  }

  async remove(c: TContext, id: TId) {
    await c.db
      .update(this.table)
      .set({
        isDeleted: true,
        deletedAt: c.nowDatetime,
      } as Partial<TTable["$inferInsert"]>)
      .where(and(...this.getFilters(c, id)));
  }
}

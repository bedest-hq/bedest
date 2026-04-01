import {
  and,
  eq,
  getTableColumns,
  type SQL,
  type InferInsertModel,
  type InferSelectModel,
  count,
} from "drizzle-orm";
import {
  PgTable,
  type SelectedFields,
  type PgUpdateSetSource,
} from "drizzle-orm/pg-core";
import { type IBaseTable } from "../interfaces/IBaseTable";
import { Prettify } from "elysia/types";
import { IApp } from "../interfaces/IContextApp";
import { status } from "elysia";

export abstract class ServiceBase<
  TTable extends IBaseTable,
  TId extends string | number = string,
  TContext extends IApp = IApp,
  TInsertData = Prettify<
    Omit<
      InferInsertModel<TTable>,
      "id" | "createdAt" | "isDeleted" | "deletedAt"
    >
  >,
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

  async create(c: TContext, data: TInsertData): Promise<{ id: TId }> {
    const payload = {
      ...(data as object),
      createdAt: c.nowDatetime,
      isDeleted: false,
    } as InferInsertModel<TTable>;

    const [res] = await c.db
      .insert(this.table)
      .values(payload)
      .returning({ id: this.table.id });

    if (!res) {
      throw status("Internal Server Error");
    }
    return res as { id: TId };
  }

  async getAll<TSelection extends SelectedFields>(
    c: TContext,
    query: { limit: number; page: number },
    columns: TSelection,
  ): Promise<{
    data: Prettify<InferSelectModel<TTable>>[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const offset = (query.page - 1) * query.limit;
    const filters = this.getFilters();

    const [totalRes] = await c.db
      .select({ count: count() })
      .from(this.table as unknown as PgTable)
      .where(and(...filters));

    const total = Number(totalRes.count);

    const dbQuery = c.db
      .select(columns)
      .from(this.table as unknown as PgTable)
      .where(and(...filters))
      .$dynamic();

    const data = (await dbQuery.limit(query.limit).offset(offset)) as Prettify<
      InferSelectModel<TTable>
    >[];

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getById<TSelection extends SelectedFields>(
    c: TContext,
    id: TId,
    columns: TSelection,
  ): Promise<Prettify<InferSelectModel<TTable>>> {
    const [res] = await c.db
      .select(columns)
      .from(this.table as unknown as PgTable)
      .where(and(...this.getFilters(id)));

    if (!res) {
      throw status("Not Found");
    }
    return res as Prettify<InferSelectModel<TTable>>;
  }

  async update(
    c: TContext,
    id: TId,
    data: Prettify<
      Partial<
        Omit<
          InferInsertModel<TTable>,
          "id" | "tenantId" | "createdAt" | "isDeleted" | "deletedAt"
        >
      >
    >,
  ): Promise<{ success: boolean }> {
    const update = await c.db
      .update(this.table)
      .set(data as PgUpdateSetSource<TTable>)
      .where(and(...this.getFilters(id)));

    if (update.rowCount === 0) {
      throw status("Not Found");
    }

    return { success: true };
  }

  async remove(c: TContext, id: TId): Promise<{ success: boolean }> {
    const payload = {
      isDeleted: true,
      deletedAt: c.nowDatetime,
    } as PgUpdateSetSource<TTable>;

    await c.db
      .update(this.table)
      .set(payload)
      .where(and(...this.getFilters(id)));

    return { success: true };
  }
}

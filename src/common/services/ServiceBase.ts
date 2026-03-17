import {
  and,
  eq,
  getTableColumns,
  type SQL,
  type InferInsertModel,
  type InferSelectModel,
} from "drizzle-orm";
import {
  PgTable,
  type SelectedFields,
  type PgUpdateSetSource,
} from "drizzle-orm/pg-core";
import ErrorHandler from "@/infrastructure/error/ErrorHandler";
import { type IBaseTable } from "../interfaces/IBaseTable";
import { Prettify } from "elysia/types";
import { IApp } from "../interfaces/IContextApp";

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
      throw ErrorHandler.internal("Creation failed");
    }
    return res as { id: TId };
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
  ): Promise<void> {
    const update = await c.db
      .update(this.table)
      .set(data as PgUpdateSetSource<TTable>)
      .where(and(...this.getFilters(id)));

    if (update.rowCount === 0) {
      throw ErrorHandler.notFound("Record not found");
    }
  }

  async getAll<TSelection extends SelectedFields>(
    c: TContext,
    query: { limit: number; page: number },
    columns: TSelection,
  ): Promise<Prettify<InferSelectModel<TTable>>[]> {
    const offset = (query.page - 1) * query.limit;

    const dbQuery = c.db
      .select(columns)
      .from(this.table as unknown as PgTable)
      .where(and(...this.getFilters()))
      .$dynamic();

    return (await dbQuery.limit(query.limit).offset(offset)) as Prettify<
      InferSelectModel<TTable>
    >[];
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
      throw ErrorHandler.notFound();
    }
    return res as Prettify<InferSelectModel<TTable>>;
  }

  async remove(c: TContext, id: TId): Promise<void> {
    const payload = {
      isDeleted: true,
      deletedAt: c.nowDatetime,
    } as PgUpdateSetSource<TTable>;

    await c.db
      .update(this.table)
      .set(payload)
      .where(and(...this.getFilters(id)));
  }
}

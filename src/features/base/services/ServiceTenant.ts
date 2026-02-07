import { IUserApp } from "@/common/interfaces/IContextApp";
import { IBaseTable } from "../interfaces/IBaseTable";
import { ServiceBase } from "./ServiceBase";
import { AnyPgTable } from "drizzle-orm/pg-core";
import { AnyColumn, eq } from "drizzle-orm";

export class ServiceTenant<
  TTable extends AnyPgTable & IBaseTable & { tenantId: AnyColumn },
  TContext extends IUserApp,
> extends ServiceBase<TTable, string, TContext> {
  protected getFilters(c: TContext, id?: string) {
    const filters = super.getFilters(c, id);

    filters.push(eq(this.table.tenantId, c.session.tenantId));

    return filters;
  }
  async create(c: TContext, data: TTable["$inferInsert"]) {
    const dataWithTenant = {
      ...data,
      tenantId: c.session.tenantId,
    };
    return super.create(c, dataWithTenant);
  }
}

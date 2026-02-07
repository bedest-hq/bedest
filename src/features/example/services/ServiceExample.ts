import { TbExample } from "../tables/TbExample";
import { ServiceBase } from "../../base/services/ServiceBase";
import { InferInsertModel } from "drizzle-orm";
import { IUserApp } from "../../../common/interfaces/IContextApp";
import { SelectedFields } from "drizzle-orm/pg-core";

export type ExampleData = Omit<InferInsertModel<typeof TbExample>, "agencyId">;

const base = new ServiceBase<typeof TbExample, string, IUserApp>(TbExample);

class ServiceExample {
  async create(c: IUserApp, data: ExampleData) {
    return base.create(c, { ...data });
  }

  async update(c: IUserApp, id: string, data: Partial<ExampleData>) {
    return base.update(c, id, data);
  }

  async get(c: IUserApp, columns: SelectedFields) {
    return base.get(c, columns);
  }

  async getById(c: IUserApp, columns: SelectedFields, id: string) {
    return base.getById(c, columns, id);
  }

  async remove(c: IUserApp, id: string) {
    return base.remove(c, id);
  }
}

export default new ServiceExample();

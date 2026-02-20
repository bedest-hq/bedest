import type { TDb } from "../types/TDb";
import type { ISession } from "../../features/session/interfaces/ISession";

export interface IApp {
  db: TDb;
  nowDatetime: Date;
}

export interface ITenantApp extends IApp {
  tenantId: string;
}

export interface IUserApp extends ITenantApp {
  session: ISession;
}

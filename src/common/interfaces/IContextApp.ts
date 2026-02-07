import type { Context } from "elysia";
import type { TDb } from "../types/TDb";
import type { ISession } from "../../features/session/interfaces/ISession";

export interface IApp {
  db: TDb;
  nowDatetime: Date;
}

export interface IUserApp extends IApp {
  session: ISession;
}

export interface IAppContext extends Context {
  db: TDb;
  nowDatetime: Date;
}

export interface IUserAppContext extends IAppContext {
  session: ISession;
}

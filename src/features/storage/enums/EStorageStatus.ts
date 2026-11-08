import { pgEnum } from "drizzle-orm/pg-core";

export enum EStorageStatus {
  /** Row reserved by a presigned upload; the object may not exist yet. */
  PENDING = "PENDING",
  /** Object stored and verified; the only state that is ever served. */
  READY = "READY",
}

export const EStorageStatusPg = pgEnum("storage_status", [
  EStorageStatus.PENDING,
  EStorageStatus.READY,
]);

import { t } from "elysia";
import { SDatetime } from "./SDatetime";
import { SId } from "./SId";

export const SDefault = {
  id: SId,
  createdBy: SId,
  isDeleted: t.Boolean(),
  createdAt: SDatetime,
  deletedAt: SDatetime,
};

import { t } from "elysia";
import { VDatetime } from "./VDatetime";
import { VId } from "./VId";

export const VDefault = {
  id: VId,
  createdBy: VId,
  isDeleted: t.Boolean(),
  createdAt: VDatetime,
  deletedAt: VDatetime,
};

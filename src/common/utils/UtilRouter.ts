import { type TSchema } from "elysia";

export class UtilRouter {
  static defSchema<T extends TSchema>(schema: T) {
    return schema;
  }

  static defResponse<T>(data: T) {
    return data;
  }
}

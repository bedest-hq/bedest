import { Elysia, t } from "elysia";
import Context from "@/app/Context";
import ServiceSystem from "../services/ServiceSystem";
import { EUserRole } from "@/features/user/enums/EUserRole";
import { RouterSystemLog } from "./RouterSystemLog";

export const RouterSystem = new Elysia({
  prefix: "/system",
  tags: ["System"],
})
  .use(RouterSystemLog)
  .use(Context.User())
  .guard(
    {
      RoleGuard: [EUserRole.SYSTEM],
    },
    (app) =>
      app
        .get("/maintenance", () => {
          return {
            isMaintenance: ServiceSystem.getMaintenance(),
          };
        })
        .post(
          "/maintenance",
          ({ body }) => {
            ServiceSystem.setMaintenance(body.status);
            return {
              isMaintenance: ServiceSystem.getMaintenance(),
            };
          },
          {
            body: t.Object({
              status: t.Boolean(),
            }),
          },
        ),
  );

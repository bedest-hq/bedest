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
        .get("/maintenance", async ({ userRuntime }) => {
          return {
            isMaintenance: await ServiceSystem.getMaintenance(userRuntime),
          };
        })
        .post(
          "/maintenance",
          async ({ body, userRuntime }) => {
            await ServiceSystem.setMaintenance(userRuntime, body.status);
            return {
              isMaintenance: await ServiceSystem.getMaintenance(userRuntime),
            };
          },
          {
            body: t.Object({
              status: t.Boolean(),
            }),
          },
        ),
  );

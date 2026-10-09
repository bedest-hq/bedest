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
        .get("/maintenance", async () => {
          return {
            isMaintenance: await ServiceSystem.getMaintenance(),
          };
        })
        .post(
          "/maintenance",
          async ({ body }) => {
            await ServiceSystem.setMaintenance(body.status);
            return {
              isMaintenance: await ServiceSystem.getMaintenance(),
            };
          },
          {
            body: t.Object({
              status: t.Boolean(),
            }),
          },
        ),
  );

import { EUserRole } from "../../features/user/enums/EUserRole";
import {
  SYSTEM_EMAIL,
  SYSTEM_TENANT_NAME,
  SYSTEM_USER_NAME,
  SYSTEM_USER_PASSWORD,
} from "../../common/constants";
import ServiceUser from "@/features/user/services/ServiceUser";
import ContextBuilder from "../context/ContextBuilder";
import DbManager from "@/infrastructure/database/DbManager";
import ServiceTenant from "@f/tenant/services/ServiceTenant";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";

export async function seed() {
  const { userContext } = ContextBuilder.build();
  const datetimeNow = new Date();
  const datetimeNextYear = new Date();
  datetimeNextYear.setFullYear(datetimeNow.getFullYear() + 1);

  const tenant = await ServiceTenant.create(userContext, {
    name: SYSTEM_TENANT_NAME,
    country: "Turkey",
    domain: "bedest.com",
    phone: "xxx-xxx-xxx-xxxx",
    email: SYSTEM_EMAIL,
    plan: ETenantPlan.PROFESSIONAL,
    planStart: datetimeNow,
    planEnd: datetimeNextYear,
  });

  userContext.tenantId = tenant.id;

  await ServiceUser.create(userContext, {
    name: SYSTEM_USER_NAME,
    email: SYSTEM_EMAIL,
    password: SYSTEM_USER_PASSWORD,
    role: EUserRole.SYSTEM,
  });

  await DbManager.shutdown();
}

await seed();

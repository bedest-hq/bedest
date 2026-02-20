import { EUserRole } from "../../features/user/enums/EUserRole";
import {
  EXAMPLE_EMAIL,
  EXAMPLE_TENANT_NAME,
  EXAMPLE_USER_NAME,
  EXAMPLE_USER_PASSWORD,
} from "../../common/constants";
import ServiceUser from "@/features/user/services/ServiceUser";
import ServiceExample from "@/features/example/services/ServiceExample";
import ContextBuilder from "../context/ContextBuilder";
import DbManager from "@/infrastructure/db/DbManager";
import ServiceTenant from "@f/tenant/services/ServiceTenant";
import { ETenantPlan } from "@f/tenant/enums/ETenantPlan";

export async function MockData() {
  const { MockUserContext } = ContextBuilder.build();

  const tenant = await ServiceTenant.create(MockUserContext, {
    name: EXAMPLE_TENANT_NAME,
    country: "Example Country",
    phone: "555-555-5555",
    email: EXAMPLE_EMAIL,
    plan: ETenantPlan.PROFESSIONAL,
    planStart: new Date(),
    planEnd: new Date(),
  });

  MockUserContext.tenantId = tenant.id;

  await ServiceUser.create(MockUserContext, {
    name: EXAMPLE_USER_NAME,
    email: EXAMPLE_EMAIL,
    password: EXAMPLE_USER_PASSWORD,
    role: EUserRole.USER,
  });

  await ServiceExample.create(MockUserContext, {
    exampleColumn: "Example",
    otherExampleColumn: "Example Other Column",
  });

  await DbManager.shutdown();
}

await MockData();

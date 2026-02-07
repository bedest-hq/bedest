import { EUserRole } from "../../features/user/enums/EUserRole";
import {
  EXAMPLE_EMAIL,
  EXAMPLE_USER_NAME,
  EXAMPLE_USER_PASSWORD,
} from "../../common/constants";
import ServiceUser from "@/features/user/services/ServiceUser";
import ServiceExample from "@/features/example/services/ServiceExample";
import ContextBuilder from "../context/ContextBuilder";
import DbManager from "@/infrastructure/db/DbManager";

export async function MockData() {
  const { MockUserContext } = ContextBuilder.build();

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

import { swagger } from "@elysiajs/swagger";
import pkg from "../../package.json";

export const Swagger = swagger({
  path: "/docs",
  documentation: {
    info: {
      title: pkg.name,
      version: pkg.version,
    },
  },
});

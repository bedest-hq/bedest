import { swagger } from "@elysiajs/swagger";

export const Swagger = swagger({
  path: "/docs",
  documentation: {
    info: {
      title: "Bedest App",
      version: "1.0.0",
    },
  },
});

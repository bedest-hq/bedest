import { z } from "zod";
import { VEnv } from "../validations/VEnv";

export type TEnv = z.infer<typeof VEnv>;

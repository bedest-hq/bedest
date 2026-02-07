import { z } from "zod";
import { SEnv } from "../schemas/SEnv";

export type TEnv = z.infer<typeof SEnv>;

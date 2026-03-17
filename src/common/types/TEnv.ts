import { Static } from "elysia";
import { VEnv } from "../validations/VEnv";

export type TEnv = Static<typeof VEnv>;

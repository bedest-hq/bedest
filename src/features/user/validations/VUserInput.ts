import { VStr } from "bedest-core";

/** Request field schemas for users, bounded by SUser's columns [QLT-11]. */
export const VUserInput = {
  name: VStr(255),
};

import { VStr } from "bedest-core";

/** Longest stored file name (storage_files.name varchar(255)) [QLT-11]. */
export const STORAGE_NAME_MAX = 255;

/** Request field schemas for stored files, bounded by SStorage [QLT-11]. */
export const VStorageInput = {
  name: VStr(STORAGE_NAME_MAX),
  mimeType: VStr(100),
};

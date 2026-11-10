import { t } from "elysia";
import { VStr } from "bedest-core";
import { VTenantDomain } from "./VTenantDomain";

/** At most this many phone numbers / links per tenant. */
const MAX_LIST_ITEMS = 20;

/**
 * Request field schemas for tenants, bounded by the columns of STenant
 * (varchar(n) → VStr(n)) so an oversized value is a 400, never a database
 * error [QLT-11].
 */
export const VTenantInput = {
  name: VStr(255),
  domain: VTenantDomain,
  country: VStr(255),
  phones: t.Array(VStr(255), { maxItems: MAX_LIST_ITEMS }),
  links: t.Array(VStr(255), { maxItems: MAX_LIST_ITEMS }),
  address: VStr(255),
  city: VStr(255),
  state: VStr(255),
  zipCode: VStr(255),
  taxId: VStr(255),
  currency: VStr(3, 3),
  timezone: VStr(255),
  description: VStr(1000),
  tagline: VStr(255),
  workingHours: VStr(255),
  copyright: VStr(255),
};

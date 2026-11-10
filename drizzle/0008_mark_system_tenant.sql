-- Custom SQL migration file, put your code below! --
-- [SEC-13] Existing deployments: flag the tenant created by the seed
-- ("System Tenant", which owns the SYSTEM users) as the system tenant.
SELECT set_config('app.bypass_rls', 'on', true);
--> statement-breakpoint
UPDATE tenants SET "isSystem" = true
WHERE name = 'System Tenant' AND "isDeleted" = false;

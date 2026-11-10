ALTER TABLE "system_audit_logs" ALTER COLUMN "entityId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "system_audit_logs" ADD COLUMN "targetTenantId" uuid;--> statement-breakpoint
ALTER TABLE "system_audit_logs" ADD CONSTRAINT "system_audit_logs_targetTenantId_tenants_id_fk" FOREIGN KEY ("targetTenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
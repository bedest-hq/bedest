CREATE INDEX "idx_notifications_tenant_broadcast_created" ON "notifications" USING btree ("tenantId","isBroadcast","createdAt" DESC NULLS FIRST) WHERE "notifications"."isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_sessions_tenant" ON "sessions" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "idx_storage_tenant_created" ON "storage_files" USING btree ("tenantId","createdAt" DESC NULLS FIRST) WHERE "storage_files"."isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_created" ON "system_audit_logs" USING btree ("tenantId","createdAt" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "idx_users_tenant" ON "users" USING btree ("tenantId") WHERE "users"."isDeleted" = false;
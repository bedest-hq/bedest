DROP INDEX "idx_notifications_user";--> statement-breakpoint
DROP INDEX "idx_storage_active";--> statement-breakpoint
DROP INDEX "idx_tenants_active";--> statement-breakpoint
DROP INDEX "idx_users_active";--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("userId","tenantId") WHERE "notifications"."isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_storage_active" ON "storage_files" USING btree ("id") WHERE "storage_files"."isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_tenants_active" ON "tenants" USING btree ("id") WHERE "tenants"."isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_users_active" ON "users" USING btree ("id") WHERE "users"."isDeleted" = false;
DROP INDEX "idx_users_email";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email_lower" ON "users" USING btree (lower("email")) WHERE "isDeleted" = false;
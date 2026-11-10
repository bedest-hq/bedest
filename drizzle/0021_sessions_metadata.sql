ALTER TABLE "sessions" ADD COLUMN "lastUsedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ipAddress" varchar(45);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "userAgent" varchar(512);--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."plans" AS ENUM('BASIC', 'STANDARD', 'PROFESSIONAL');--> statement-breakpoint
CREATE TYPE "public"."roles" AS ENUM('SYSTEM', 'ADMIN', 'USER');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isDeleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	"tenantId" uuid NOT NULL,
	"userId" uuid,
	"isBroadcast" boolean DEFAULT false NOT NULL,
	"event" varchar(100) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL,
	"readAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"notificationId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"readAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "storage_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isDeleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	"tenantId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"key" varchar(500) NOT NULL,
	"mimeType" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	CONSTRAINT "storage_files_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "storage_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity" varchar(100) NOT NULL,
	"entityId" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isDeleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"country" varchar(255) NOT NULL,
	"phones" varchar(255)[] DEFAULT '{}' NOT NULL,
	"links" varchar(255)[] DEFAULT '{}' NOT NULL,
	"email" varchar(255) NOT NULL,
	"address" varchar(255),
	"city" varchar(255),
	"state" varchar(255),
	"zipCode" varchar(255),
	"taxId" varchar(255),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"timezone" varchar(255) DEFAULT 'UTC' NOT NULL,
	"description" varchar(1000),
	"tagline" varchar(255),
	"workingHours" varchar(255),
	"copyright" varchar(255),
	"logoId" uuid,
	"plan" "plans" NOT NULL,
	"planStart" timestamp with time zone NOT NULL,
	"planEnd" timestamp with time zone NOT NULL,
	"subscriptionId" varchar(255),
	"customerId" varchar(255),
	CONSTRAINT "tenants_name_unique" UNIQUE("name"),
	CONSTRAINT "tenants_domain_unique" UNIQUE("domain"),
	CONSTRAINT "tenants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"isDeleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deletedAt" timestamp with time zone,
	"tenantId" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "roles" NOT NULL,
	"avatarId" uuid,
	"password" varchar(255) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notificationId_notifications_id_fk" FOREIGN KEY ("notificationId") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_files" ADD CONSTRAINT "storage_files_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_audit_logs" ADD CONSTRAINT "system_audit_logs_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatarId_storage_files_id_fk" FOREIGN KEY ("avatarId") REFERENCES "public"."storage_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("userId","tenantId") WHERE "isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_notification_reads_user" ON "notification_reads" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_notification_reads_notif" ON "notification_reads" USING btree ("notificationId");--> statement-breakpoint
CREATE INDEX "sessions_userId_index" ON "sessions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "idx_storage_active" ON "storage_files" USING btree ("id") WHERE "isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "system_audit_logs" USING btree ("entity","entityId");--> statement-breakpoint
CREATE INDEX "idx_tenants_active" ON "tenants" USING btree ("id") WHERE "isDeleted" = false;--> statement-breakpoint
CREATE INDEX "idx_users_active" ON "users" USING btree ("id") WHERE "isDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email") WHERE "isDeleted" = false;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING (
      current_setting('app.bypass_rls', true) = 'on'
      OR
      "notifications"."tenantId" = nullif(current_setting('app.current_tenant', true), '')::uuid
    );--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_reads" AS PERMISSIVE FOR ALL TO public USING (
      current_setting('app.bypass_rls', true) = 'on'
      OR
      "notification_reads"."tenantId" = nullif(current_setting('app.current_tenant', true), '')::uuid
    );--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING (
      current_setting('app.bypass_rls', true) = 'on'
      OR
      "sessions"."tenantId" = nullif(current_setting('app.current_tenant', true), '')::uuid
    );--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "storage_files" AS PERMISSIVE FOR ALL TO public USING (
      current_setting('app.bypass_rls', true) = 'on'
      OR
      "storage_files"."tenantId" = nullif(current_setting('app.current_tenant', true), '')::uuid
    );--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "system_audit_logs" AS PERMISSIVE FOR ALL TO public USING (
      current_setting('app.bypass_rls', true) = 'on'
      OR
      "system_audit_logs"."tenantId" = nullif(current_setting('app.current_tenant', true), '')::uuid
    );--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenants" AS PERMISSIVE FOR ALL TO public USING (
      current_setting('app.bypass_rls', true) = 'on'
      OR
      "tenants"."id" = nullif(current_setting('app.current_tenant', true), '')::uuid
    );--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING (
      current_setting('app.bypass_rls', true) = 'on'
      OR
      "users"."tenantId" = nullif(current_setting('app.current_tenant', true), '')::uuid
    );
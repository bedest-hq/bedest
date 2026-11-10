CREATE TYPE "public"."storage_status" AS ENUM('PENDING', 'READY');--> statement-breakpoint
ALTER TABLE "storage_files" ADD COLUMN "status" "storage_status" DEFAULT 'READY' NOT NULL;
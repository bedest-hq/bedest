CREATE TABLE "revoked_refresh_tokens" (
	"sessionId" uuid PRIMARY KEY NOT NULL,
	"familyId" uuid NOT NULL,
	"revokedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "familyId" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_revoked_refresh_tokens_revoked_at" ON "revoked_refresh_tokens" USING btree ("revokedAt");--> statement-breakpoint
CREATE INDEX "idx_sessions_family" ON "sessions" USING btree ("familyId");
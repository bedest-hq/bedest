CREATE TABLE "login_attempts" (
	"emailHash" char(64) PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"firstFailureAt" timestamp with time zone NOT NULL,
	"lockedUntil" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_login_attempts_first_failure" ON "login_attempts" USING btree ("firstFailureAt");
CREATE TABLE "billing_events" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"type" varchar(100) NOT NULL,
	"receivedAt" timestamp with time zone NOT NULL,
	"processedAt" timestamp with time zone
);

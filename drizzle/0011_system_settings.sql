CREATE TABLE "system_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);

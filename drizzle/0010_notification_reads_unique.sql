DROP INDEX "idx_notification_reads_user";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notification_reads_user_notification" ON "notification_reads" USING btree ("userId","notificationId");
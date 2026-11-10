-- Custom SQL migration file, put your code below! --
-- [BUG-05] One read receipt per (notification, user): delete duplicates
-- before the unique index is created by the next migration, keeping the
-- earliest readAt (then the lowest id). Receipts are infrastructure rows
-- (hard delete allowed). The owner is subject to FORCE RLS, so the policy
-- bypass is enabled for this transaction.
SELECT set_config('app.bypass_rls', 'on', true);
--> statement-breakpoint
DELETE FROM notification_reads a
USING notification_reads b
WHERE a."notificationId" = b."notificationId"
  AND a."userId" = b."userId"
  AND (a."readAt" > b."readAt" OR (a."readAt" = b."readAt" AND a.id > b.id));

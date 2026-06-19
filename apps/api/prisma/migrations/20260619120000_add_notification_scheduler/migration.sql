-- AlterTable
ALTER TABLE `notification_preferences`
    ADD COLUMN `silentDays` JSON NULL,
    ADD COLUMN `examSprintDays` INTEGER NOT NULL DEFAULT 14;

-- AlterTable
ALTER TABLE `email_logs`
    ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `schedulerRunId` VARCHAR(191) NULL,
    ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
    ADD COLUMN `skipReason` TEXT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `email_logs_dedupeKey_key` ON `email_logs`(`dedupeKey`);
CREATE INDEX `email_logs_source_schedulerRunId_idx` ON `email_logs`(`source`, `schedulerRunId`);

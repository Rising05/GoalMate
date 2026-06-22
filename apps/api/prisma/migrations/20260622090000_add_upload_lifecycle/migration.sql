ALTER TABLE `upload_assets`
  ADD COLUMN `verifiedMimeType` VARCHAR(191) NULL,
  ADD COLUMN `verifiedSizeBytes` INTEGER NULL,
  ADD COLUMN `uploadExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `scanAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `scanStartedAt` DATETIME(3) NULL,
  ADD COLUMN `scanCompletedAt` DATETIME(3) NULL,
  ADD COLUMN `deleteAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `deleteError` TEXT NULL,
  ADD COLUMN `lastDeleteAttemptAt` DATETIME(3) NULL;

CREATE INDEX `upload_assets_status_uploadExpiresAt_idx` ON `upload_assets`(`status`, `uploadExpiresAt`);
CREATE INDEX `upload_assets_scanStatus_updatedAt_idx` ON `upload_assets`(`scanStatus`, `updatedAt`);

UPDATE `upload_assets`
SET `verifiedMimeType` = `mimeType`,
    `verifiedSizeBytes` = `sizeBytes`,
    `scanCompletedAt` = COALESCE(`uploadedAt`, `updatedAt`)
WHERE `status` = 'READY' AND `scanStatus` = 'CLEAN';

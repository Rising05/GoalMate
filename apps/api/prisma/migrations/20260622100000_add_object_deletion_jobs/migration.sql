ALTER TABLE `upload_assets` ADD COLUMN `goalId` VARCHAR(191) NULL;

CREATE INDEX `upload_assets_goalId_status_idx` ON `upload_assets`(`goalId`, `status`);

UPDATE `upload_assets`
SET `goalId` = JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.goalId'))
WHERE `metadata` IS NOT NULL
  AND JSON_VALID(`metadata`)
  AND JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.goalId')) IN (SELECT `id` FROM `goals`);

ALTER TABLE `upload_assets` ADD CONSTRAINT `upload_assets_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `object_deletion_jobs` (
  `id` VARCHAR(191) NOT NULL,
  `storageProvider` VARCHAR(191) NOT NULL,
  `objectKey` TEXT NULL,
  `objectKeyHash` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(191) NOT NULL,
  `sourceId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `error` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `completedAt` DATETIME(3) NULL,
  UNIQUE INDEX `object_deletion_jobs_storageProvider_objectKeyHash_key`(`storageProvider`, `objectKeyHash`),
  INDEX `object_deletion_jobs_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `upload_assets` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'WEB',
    `purpose` VARCHAR(191) NOT NULL DEFAULT 'CHECKIN_EVIDENCE',
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `checksumSha256` VARCHAR(191) NULL,
    `storageProvider` VARCHAR(191) NOT NULL DEFAULT 'LOCAL_PLACEHOLDER',
    `objectKey` VARCHAR(191) NOT NULL,
    `publicUrl` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'READY',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `upload_assets_objectKey_key`(`objectKey`),
    INDEX `upload_assets_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `upload_assets_source_purpose_idx`(`source`, `purpose`),
    INDEX `upload_assets_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `upload_assets` ADD CONSTRAINT `upload_assets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

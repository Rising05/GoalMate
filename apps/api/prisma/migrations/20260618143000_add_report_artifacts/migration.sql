-- CreateTable
CREATE TABLE `report_artifacts` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NOT NULL,
    `body` LONGTEXT NOT NULL,
    `recommendations` JSON NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NULL,
    `promptVersion` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'READY',
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `report_artifacts_goalId_type_periodEnd_key`(`goalId`, `type`, `periodEnd`),
    INDEX `report_artifacts_goalId_createdAt_idx`(`goalId`, `createdAt`),
    INDEX `report_artifacts_status_type_idx`(`status`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `report_artifacts` ADD CONSTRAINT `report_artifacts_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

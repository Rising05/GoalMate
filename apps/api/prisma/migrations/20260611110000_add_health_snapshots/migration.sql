CREATE TABLE `health_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `healthScore` INTEGER NOT NULL,
    `deviationEventId` VARCHAR(191) NULL,
    `completionMetrics` JSON NOT NULL,
    `rescueMetrics` JSON NOT NULL,
    `riskLevel` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `health_snapshots_goalId_date_key`(`goalId`, `date`),
    INDEX `health_snapshots_goalId_date_idx`(`goalId`, `date`),
    INDEX `health_snapshots_goalId_riskLevel_idx`(`goalId`, `riskLevel`),
    INDEX `health_snapshots_deviationEventId_idx`(`deviationEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `health_snapshots`
    ADD CONSTRAINT `health_snapshots_goalId_fkey`
    FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

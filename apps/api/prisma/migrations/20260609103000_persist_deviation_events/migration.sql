CREATE TABLE `deviation_events` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `sourceDailyTaskId` VARCHAR(191) NULL,
    `riskLevel` VARCHAR(191) NOT NULL,
    `primaryReasonCode` VARCHAR(191) NULL,
    `primaryReasonLabel` VARCHAR(191) NULL,
    `primaryReasonDetail` TEXT NULL,
    `reasons` JSON NOT NULL,
    `metrics` JSON NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `deviation_events_goalId_detectedAt_idx`(`goalId`, `detectedAt`),
    INDEX `deviation_events_goalId_riskLevel_idx`(`goalId`, `riskLevel`),
    INDEX `deviation_events_sourceDailyTaskId_idx`(`sourceDailyTaskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `daily_tasks`
    ADD COLUMN `deviationEventId` VARCHAR(191) NULL;

CREATE INDEX `daily_tasks_deviationEventId_idx` ON `daily_tasks`(`deviationEventId`);

ALTER TABLE `deviation_events`
    ADD CONSTRAINT `deviation_events_goalId_fkey`
    FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `daily_tasks`
    ADD CONSTRAINT `daily_tasks_deviationEventId_fkey`
    FOREIGN KEY (`deviationEventId`) REFERENCES `deviation_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

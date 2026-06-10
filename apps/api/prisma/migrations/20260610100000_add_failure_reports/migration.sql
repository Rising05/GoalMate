CREATE TABLE `failure_reports` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `reasonAnalysis` TEXT NOT NULL,
    `brokenStreakTimeline` JSON NOT NULL,
    `lowScoreTasks` JSON NOT NULL,
    `keyDeviationNodes` JSON NOT NULL,
    `suggestion` TEXT NOT NULL,
    `restartGoalDraft` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `failure_reports_goalId_key`(`goalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `failure_reports`
    ADD CONSTRAINT `failure_reports_goalId_fkey`
    FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

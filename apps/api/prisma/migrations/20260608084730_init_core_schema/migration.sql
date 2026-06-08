-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'DISABLED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `memberships` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `plan` ENUM('FREE', 'PRO') NOT NULL DEFAULT 'FREE',
    `status` ENUM('ACTIVE', 'EXPIRED', 'MANUAL') NOT NULL DEFAULT 'ACTIVE',
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `memberships_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `goals` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `category` ENUM('STUDY', 'CAREER', 'FITNESS', 'HABIT', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
    `status` ENUM('DRAFT', 'GENERATING_PLAN', 'WAITING_CONFIRMATION', 'ACTIVE', 'AT_RISK', 'REPLANNING', 'COMPLETED', 'FAILED', 'GENERATION_FAILED') NOT NULL DEFAULT 'DRAFT',
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Shanghai',
    `toleranceDaysAllowed` INTEGER NOT NULL DEFAULT 0,
    `toleranceDaysUsed` INTEGER NOT NULL DEFAULT 0,
    `dailyTimeBudgetMinutes` INTEGER NULL,
    `currentBaseline` TEXT NULL,
    `constraints` TEXT NULL,
    `finalReward` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `goals_userId_status_idx`(`userId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `summary` TEXT NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plans_goalId_key`(`goalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `milestones` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `targetDate` DATETIME(3) NOT NULL,
    `rewardText` TEXT NULL,
    `isCompleted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `milestones_goalId_targetDate_idx`(`goalId`, `targetDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `weekly_plans` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `weekIndex` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NOT NULL,
    `startsOn` DATETIME(3) NOT NULL,
    `endsOn` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `weekly_plans_planId_weekIndex_key`(`planId`, `weekIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `weeklyPlanId` VARCHAR(191) NULL,
    `taskDate` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `plannedMinutes` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_tasks_goalId_taskDate_idx`(`goalId`, `taskDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `checkins` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `dailyTaskId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'SUBMITTED', 'SCORING', 'SCORED', 'SCORE_FAILED', 'APPEALING', 'RESCORED', 'APPEAL_REJECTED') NOT NULL DEFAULT 'SUBMITTED',
    `content` TEXT NOT NULL,
    `investedMinutes` INTEGER NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `checkins_goalId_submittedAt_idx`(`goalId`, `submittedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_scores` (
    `id` VARCHAR(191) NOT NULL,
    `checkinId` VARCHAR(191) NOT NULL,
    `totalScore` INTEGER NOT NULL,
    `dimensions` JSON NOT NULL,
    `evidence` JSON NOT NULL,
    `summary` TEXT NOT NULL,
    `suggestion` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_scores_checkinId_key`(`checkinId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `payload` JSON NOT NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_jobs_status_type_idx`(`status`, `type`),
    INDEX `ai_jobs_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `memberships` ADD CONSTRAINT `memberships_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `goals` ADD CONSTRAINT `goals_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plans` ADD CONSTRAINT `plans_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `milestones` ADD CONSTRAINT `milestones_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_plans` ADD CONSTRAINT `weekly_plans_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_tasks` ADD CONSTRAINT `daily_tasks_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_tasks` ADD CONSTRAINT `daily_tasks_weeklyPlanId_fkey` FOREIGN KEY (`weeklyPlanId`) REFERENCES `weekly_plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkins` ADD CONSTRAINT `checkins_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkins` ADD CONSTRAINT `checkins_dailyTaskId_fkey` FOREIGN KEY (`dailyTaskId`) REFERENCES `daily_tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_scores` ADD CONSTRAINT `ai_scores_checkinId_fkey` FOREIGN KEY (`checkinId`) REFERENCES `checkins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_jobs` ADD CONSTRAINT `ai_jobs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_jobs` ADD CONSTRAINT `ai_jobs_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `score_appeals` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `checkinId` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `addedFacts` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `originalScore` INTEGER NOT NULL,
    `newScore` INTEGER NULL,
    `evidence` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `score_appeals_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `score_appeals_checkinId_createdAt_idx`(`checkinId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `score_appeals`
    ADD CONSTRAINT `score_appeals_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `score_appeals`
    ADD CONSTRAINT `score_appeals_checkinId_fkey`
    FOREIGN KEY (`checkinId`) REFERENCES `checkins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

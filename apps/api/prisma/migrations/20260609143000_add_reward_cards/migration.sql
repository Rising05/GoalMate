CREATE TABLE `reward_cards` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `cardType` VARCHAR(191) NOT NULL DEFAULT 'TEXT',
    `sourceType` VARCHAR(191) NOT NULL DEFAULT 'CUSTOM',
    `sourceRefId` VARCHAR(191) NULL,
    `imageUrl` TEXT NULL,
    `linkUrl` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reward_cards_goalId_sortOrder_idx`(`goalId`, `sortOrder`),
    INDEX `reward_cards_goalId_sourceType_idx`(`goalId`, `sourceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reward_cards`
    ADD CONSTRAINT `reward_cards_goalId_fkey`
    FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `notification_preferences` ADD COLUMN `channels` JSON NULL;

-- AlterTable
ALTER TABLE `email_logs` ADD COLUMN `channel` VARCHAR(191) NOT NULL DEFAULT 'EMAIL';

-- CreateTable
CREATE TABLE `wechat_bindings` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `openId` VARCHAR(191) NOT NULL,
    `unionId` VARCHAR(191) NULL,
    `nickname` VARCHAR(191) NULL,
    `avatarUrl` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `boundAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wechat_bindings_userId_key`(`userId`),
    UNIQUE INDEX `wechat_bindings_openId_key`(`openId`),
    UNIQUE INDEX `wechat_bindings_unionId_key`(`unionId`),
    INDEX `wechat_bindings_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `email_logs_channel_status_idx` ON `email_logs`(`channel`, `status`);

-- AddForeignKey
ALTER TABLE `wechat_bindings` ADD CONSTRAINT `wechat_bindings_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

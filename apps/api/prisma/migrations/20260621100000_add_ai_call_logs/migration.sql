CREATE TABLE `ai_call_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NULL,
    `aiJobId` VARCHAR(191) NULL,
    `capability` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NULL,
    `promptVersion` VARCHAR(191) NOT NULL,
    `inputHash` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `promptTokens` INTEGER NULL,
    `completionTokens` INTEGER NULL,
    `totalTokens` INTEGER NULL,
    `latencyMs` INTEGER NOT NULL,
    `estimatedCostMicros` INTEGER NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `errorCategory` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `fallbackUsed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_call_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ai_call_logs_goalId_capability_createdAt_idx`(`goalId`, `capability`, `createdAt`),
    INDEX `ai_call_logs_status_errorCategory_createdAt_idx`(`status`, `errorCategory`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_call_logs` ADD CONSTRAINT `ai_call_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ai_call_logs` ADD CONSTRAINT `ai_call_logs_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ai_call_logs` ADD CONSTRAINT `ai_call_logs_aiJobId_fkey` FOREIGN KEY (`aiJobId`) REFERENCES `ai_jobs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

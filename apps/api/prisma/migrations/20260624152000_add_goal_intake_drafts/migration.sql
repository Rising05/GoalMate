CREATE TABLE `goal_intake_drafts` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `naturalLanguage` TEXT NOT NULL,
  `naturalLanguageKeyVersion` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ANALYZED',
  `provider` VARCHAR(191) NOT NULL DEFAULT 'rule',
  `analysis` TEXT NULL,
  `analysisKeyVersion` VARCHAR(191) NULL,
  `formDraft` TEXT NULL,
  `formDraftKeyVersion` VARCHAR(191) NULL,
  `answers` TEXT NULL,
  `answersKeyVersion` VARCHAR(191) NULL,
  `acceptedFields` JSON NULL,
  `completedGoalId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `goal_intake_drafts_completedGoalId_key`(`completedGoalId`),
  INDEX `goal_intake_drafts_userId_updatedAt_idx`(`userId`, `updatedAt`),
  INDEX `goal_intake_drafts_userId_status_idx`(`userId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `goal_intake_drafts`
  ADD CONSTRAINT `goal_intake_drafts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `goal_intake_drafts_completedGoalId_fkey` FOREIGN KEY (`completedGoalId`) REFERENCES `goals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

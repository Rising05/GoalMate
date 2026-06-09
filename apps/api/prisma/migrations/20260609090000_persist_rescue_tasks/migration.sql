ALTER TABLE `daily_tasks`
  ADD COLUMN `sourceDailyTaskId` VARCHAR(191) NULL,
  ADD COLUMN `taskType` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `rescueReason` TEXT NULL,
  ADD COLUMN `rescueTriggerCode` VARCHAR(191) NULL,
  ADD COLUMN `rescueRiskLevel` VARCHAR(191) NULL;

CREATE INDEX `daily_tasks_goalId_taskType_status_idx` ON `daily_tasks`(`goalId`, `taskType`, `status`);
CREATE INDEX `daily_tasks_sourceDailyTaskId_idx` ON `daily_tasks`(`sourceDailyTaskId`);

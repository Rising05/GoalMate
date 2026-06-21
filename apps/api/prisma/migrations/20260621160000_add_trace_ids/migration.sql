ALTER TABLE `ai_jobs` ADD COLUMN `traceId` VARCHAR(191) NULL;
ALTER TABLE `email_logs` ADD COLUMN `traceId` VARCHAR(191) NULL;
ALTER TABLE `ai_call_logs` ADD COLUMN `traceId` VARCHAR(191) NULL;

CREATE INDEX `ai_jobs_traceId_idx` ON `ai_jobs`(`traceId`);
CREATE INDEX `email_logs_traceId_idx` ON `email_logs`(`traceId`);
CREATE INDEX `ai_call_logs_traceId_createdAt_idx` ON `ai_call_logs`(`traceId`, `createdAt`);

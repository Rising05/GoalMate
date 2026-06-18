-- AlterTable
ALTER TABLE `email_logs`
    ADD COLUMN `provider` VARCHAR(191) NULL,
    ADD COLUMN `providerMessageId` VARCHAR(191) NULL,
    ADD COLUMN `errorCode` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `email_logs_provider_providerMessageId_idx` ON `email_logs`(`provider`, `providerMessageId`);

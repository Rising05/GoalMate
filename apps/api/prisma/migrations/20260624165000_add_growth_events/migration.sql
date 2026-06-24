CREATE TABLE `growth_events` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `goalId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `sourceResourceType` VARCHAR(191) NOT NULL,
  `sourceResourceId` VARCHAR(191) NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `metadata` JSON NULL,
  `derived` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `growth_events_type_sourceResourceType_sourceResourceId_key`(`type`, `sourceResourceType`, `sourceResourceId`),
  INDEX `growth_events_userId_occurredAt_idx`(`userId`, `occurredAt`),
  INDEX `growth_events_goalId_occurredAt_idx`(`goalId`, `occurredAt`),
  INDEX `growth_events_userId_type_occurredAt_idx`(`userId`, `type`, `occurredAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `growth_events`
  ADD CONSTRAINT `growth_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `growth_events_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `payment_orders` (
  `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL, `plan` VARCHAR(191) NOT NULL,
  `durationDays` INTEGER NOT NULL, `amountCents` INTEGER NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY', `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `providerOrderId` VARCHAR(191) NULL, `checkoutUrl` TEXT NULL,
  `paidAt` DATETIME(3) NULL, `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payment_orders_providerOrderId_key`(`providerOrderId`),
  INDEX `payment_orders_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `payment_orders_provider_status_idx`(`provider`, `status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `payment_events` (
  `id` VARCHAR(191) NOT NULL, `orderId` VARCHAR(191) NULL, `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL, `providerEventId` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL, `payload` JSON NOT NULL, `processedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `payment_events_providerEventId_key`(`providerEventId`),
  INDEX `payment_events_provider_createdAt_idx`(`provider`, `createdAt`),
  INDEX `payment_events_orderId_createdAt_idx`(`orderId`, `createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `membership_audits` (
  `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL, `actorUserId` VARCHAR(191) NULL,
  `orderId` VARCHAR(191) NULL, `action` VARCHAR(191) NOT NULL, `fromPlan` VARCHAR(191) NULL,
  `toPlan` VARCHAR(191) NOT NULL, `fromStatus` VARCHAR(191) NULL, `toStatus` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NULL, `reason` TEXT NULL, `metadata` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `membership_audits_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `membership_audits_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `payment_orders` ADD CONSTRAINT `payment_orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `payment_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `membership_audits` ADD CONSTRAINT `membership_audits_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `membership_audits` ADD CONSTRAINT `membership_audits_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `membership_audits` ADD CONSTRAINT `membership_audits_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `payment_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

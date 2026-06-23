CREATE TABLE `billing_plans` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `plan` VARCHAR(191) NOT NULL DEFAULT 'PRO',
  `durationDays` INTEGER NOT NULL,
  `amountCents` INTEGER NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `billing_plans_code_key`(`code`),
  INDEX `billing_plans_status_plan_idx`(`status`, `plan`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `subscriptions` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `providerSubscriptionId` VARCHAR(191) NULL,
  `billingPlanId` VARCHAR(191) NULL,
  `plan` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `currentPeriodStart` DATETIME(3) NOT NULL,
  `currentPeriodEnd` DATETIME(3) NOT NULL,
  `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
  `canceledAt` DATETIME(3) NULL,
  `sourceOrderId` VARCHAR(191) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `subscriptions_providerSubscriptionId_key`(`providerSubscriptionId`),
  INDEX `subscriptions_userId_status_currentPeriodEnd_idx`(`userId`, `status`, `currentPeriodEnd`),
  INDEX `subscriptions_provider_status_idx`(`provider`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payments` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NULL,
  `userId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(191) NOT NULL,
  `providerPaymentId` VARCHAR(191) NULL,
  `type` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `amountCents` INTEGER NOT NULL,
  `refundedCents` INTEGER NOT NULL DEFAULT 0,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
  `reason` TEXT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payments_providerPaymentId_key`(`providerPaymentId`),
  INDEX `payments_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `payments_provider_type_status_idx`(`provider`, `type`, `status`),
  INDEX `payments_orderId_createdAt_idx`(`orderId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_orders`
  ADD COLUMN `billingPlanId` VARCHAR(191) NULL,
  ADD COLUMN `subscriptionId` VARCHAR(191) NULL,
  ADD INDEX `payment_orders_subscriptionId_createdAt_idx`(`subscriptionId`, `createdAt`);

ALTER TABLE `subscriptions`
  ADD CONSTRAINT `subscriptions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `payment_orders`
  ADD CONSTRAINT `payment_orders_billingPlanId_fkey` FOREIGN KEY (`billingPlanId`) REFERENCES `billing_plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `payment_orders_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payments`
  ADD CONSTRAINT `payments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `payment_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `payments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `billing_plans` (`id`, `code`, `name`, `plan`, `durationDays`, `amountCents`, `currency`, `status`, `updatedAt`)
VALUES
  ('billing-plan-pro-30', 'PRO_30D', 'GoalMate Pro 30 days', 'PRO', 30, 1900, 'CNY', 'ACTIVE', CURRENT_TIMESTAMP(3)),
  ('billing-plan-pro-90', 'PRO_90D', 'GoalMate Pro 90 days', 'PRO', 90, 4900, 'CNY', 'ACTIVE', CURRENT_TIMESTAMP(3)),
  ('billing-plan-pro-365', 'PRO_365D', 'GoalMate Pro 365 days', 'PRO', 365, 16800, 'CNY', 'ACTIVE', CURRENT_TIMESTAMP(3));

UPDATE `payment_orders`
SET `billingPlanId` = CASE
  WHEN `durationDays` = 30 THEN 'billing-plan-pro-30'
  WHEN `durationDays` = 90 THEN 'billing-plan-pro-90'
  WHEN `durationDays` = 365 THEN 'billing-plan-pro-365'
  ELSE NULL
END;

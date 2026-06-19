CREATE TABLE `entitlements` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `capability` VARCHAR(191) NOT NULL,
    `limitValue` INTEGER NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',
    `validFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `validUntil` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `entitlements_userId_capability_validFrom_validUntil_idx`(`userId`, `capability`, `validFrom`, `validUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `usage_records` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `capability` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `periodKey` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `resourceType` VARCHAR(191) NULL,
    `resourceId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `usage_records_idempotencyKey_key`(`idempotencyKey`),
    INDEX `usage_records_userId_capability_periodKey_idx`(`userId`, `capability`, `periodKey`),
    INDEX `usage_records_resourceType_resourceId_idx`(`resourceType`, `resourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `quota_buckets` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `capability` VARCHAR(191) NOT NULL,
    `periodKey` VARCHAR(191) NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,
    `limitValue` INTEGER NOT NULL,
    `resetAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `quota_buckets_userId_capability_periodKey_key`(`userId`, `capability`, `periodKey`),
    INDEX `quota_buckets_capability_periodKey_idx`(`capability`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `entitlements` ADD CONSTRAINT `entitlements_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `usage_records` ADD CONSTRAINT `usage_records_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `quota_buckets` ADD CONSTRAINT `quota_buckets_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing usage so deployment does not reset current-period consumption.
INSERT INTO `usage_records`
    (`id`, `userId`, `capability`, `quantity`, `periodKey`, `idempotencyKey`, `resourceType`, `resourceId`, `createdAt`)
SELECT
    CONCAT('ub_', `id`),
    `userId`,
    CASE
        WHEN `type` = 'GOAL_PLAN_GENERATION' THEN 'PLAN_GENERATION'
        WHEN `type` = 'GOAL_PLAN_REPLAN' THEN 'GOAL_REPLAN'
        WHEN `type` = 'CHECKIN_SCORING' THEN 'CHECKIN_SCORING'
        ELSE 'SCORE_APPEAL'
    END,
    1,
    CASE
        WHEN `type` = 'CHECKIN_SCORING' THEN DATE_FORMAT(`createdAt`, '%Y-%m-%d')
        WHEN `type` IN ('GOAL_PLAN_REPLAN', 'CHECKIN_SCORE_APPEAL')
            THEN CONCAT('WEEK:', DATE_FORMAT(DATE_SUB(DATE(`createdAt`), INTERVAL WEEKDAY(`createdAt`) DAY), '%Y-%m-%d'))
        ELSE CONCAT('MONTH:', DATE_FORMAT(`createdAt`, '%Y-%m'))
    END,
    CONCAT('backfill:ai-job:', `id`),
    'AI_JOB',
    `id`,
    `createdAt`
FROM `ai_jobs`
WHERE `type` IN ('GOAL_PLAN_GENERATION', 'GOAL_PLAN_REPLAN', 'CHECKIN_SCORING', 'CHECKIN_SCORE_APPEAL');

INSERT INTO `usage_records`
    (`id`, `userId`, `capability`, `quantity`, `periodKey`, `idempotencyKey`, `resourceType`, `resourceId`, `createdAt`)
SELECT
    CONCAT('ub_report_', ra.`id`),
    g.`userId`,
    'REPORT_GENERATION',
    1,
    CONCAT('MONTH:', DATE_FORMAT(ra.`createdAt`, '%Y-%m')),
    CONCAT('backfill:report:', ra.`id`),
    'REPORT_ARTIFACT',
    ra.`id`,
    ra.`createdAt`
FROM `report_artifacts` ra
INNER JOIN `goals` g ON g.`id` = ra.`goalId`;

INSERT INTO `usage_records`
    (`id`, `userId`, `capability`, `quantity`, `periodKey`, `idempotencyKey`, `resourceType`, `resourceId`, `createdAt`)
SELECT
    CONCAT('ub_reward_', rc.`id`),
    g.`userId`,
    'REWARD_CARD',
    1,
    'TOTAL',
    CONCAT('backfill:reward:', rc.`id`),
    'REWARD_CARD',
    rc.`id`,
    rc.`createdAt`
FROM `reward_cards` rc
INNER JOIN `goals` g ON g.`id` = rc.`goalId`
WHERE rc.`sourceType` = 'CUSTOM';

INSERT INTO `usage_records`
    (`id`, `userId`, `capability`, `quantity`, `periodKey`, `idempotencyKey`, `resourceType`, `resourceId`, `createdAt`)
SELECT
    CONCAT('ub_upload_', `id`),
    `userId`,
    'UPLOAD_STORAGE_KIB',
    CEIL(`sizeBytes` / 1024),
    'TOTAL',
    CONCAT('backfill:upload:', `id`),
    'UPLOAD_ASSET',
    `id`,
    `createdAt`
FROM `upload_assets`
WHERE `storageProvider` <> 'EXTERNAL' AND `status` NOT IN ('DELETED', 'REJECTED');

INSERT INTO `quota_buckets`
    (`id`, `userId`, `capability`, `periodKey`, `used`, `limitValue`, `resetAt`, `createdAt`, `updatedAt`)
SELECT
    CONCAT('qb_', LEFT(SHA2(CONCAT(ur.`userId`, ':', ur.`capability`, ':', ur.`periodKey`), 256), 40)),
    ur.`userId`,
    ur.`capability`,
    ur.`periodKey`,
    SUM(ur.`quantity`),
    CASE ur.`capability`
        WHEN 'PLAN_GENERATION' THEN IF(m.`plan` = 'PRO' AND m.`status` IN ('ACTIVE', 'MANUAL') AND (m.`expiresAt` IS NULL OR m.`expiresAt` > NOW()), 30, 3)
        WHEN 'CHECKIN_SCORING' THEN IF(m.`plan` = 'PRO' AND m.`status` IN ('ACTIVE', 'MANUAL') AND (m.`expiresAt` IS NULL OR m.`expiresAt` > NOW()), 30, 3)
        WHEN 'SCORE_APPEAL' THEN IF(m.`plan` = 'PRO' AND m.`status` IN ('ACTIVE', 'MANUAL') AND (m.`expiresAt` IS NULL OR m.`expiresAt` > NOW()), 10, 1)
        WHEN 'GOAL_REPLAN' THEN IF(m.`plan` = 'PRO' AND m.`status` IN ('ACTIVE', 'MANUAL') AND (m.`expiresAt` IS NULL OR m.`expiresAt` > NOW()), 10, 1)
        WHEN 'REPORT_GENERATION' THEN IF(m.`plan` = 'PRO' AND m.`status` IN ('ACTIVE', 'MANUAL') AND (m.`expiresAt` IS NULL OR m.`expiresAt` > NOW()), 20, 1)
        WHEN 'REWARD_CARD' THEN IF(m.`plan` = 'PRO' AND m.`status` IN ('ACTIVE', 'MANUAL') AND (m.`expiresAt` IS NULL OR m.`expiresAt` > NOW()), 100, 5)
        ELSE IF(m.`plan` = 'PRO' AND m.`status` IN ('ACTIVE', 'MANUAL') AND (m.`expiresAt` IS NULL OR m.`expiresAt` > NOW()), 5242880, 51200)
    END,
    NULL,
    NOW(3),
    NOW(3)
FROM `usage_records` ur
LEFT JOIN `memberships` m ON m.`userId` = ur.`userId`
GROUP BY ur.`userId`, ur.`capability`, ur.`periodKey`, m.`plan`, m.`status`, m.`expiresAt`;

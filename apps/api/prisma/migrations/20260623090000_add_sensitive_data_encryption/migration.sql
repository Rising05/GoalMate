-- Versioned application-layer encryption metadata and blind indexes.
ALTER TABLE `users`
  ADD COLUMN `termsVersion` VARCHAR(191) NULL,
  ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `privacyVersion` VARCHAR(191) NULL,
  ADD COLUMN `privacyAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `aiDisclosureVersion` VARCHAR(191) NULL,
  ADD COLUMN `aiDisclosureAcceptedAt` DATETIME(3) NULL,
  ADD COLUMN `requiresTermsAcceptance` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `wechat_bindings`
  ADD COLUMN `openIdHash` VARCHAR(191) NULL,
  ADD COLUMN `unionIdHash` VARCHAR(191) NULL,
  ADD COLUMN `openIdKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `unionIdKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `goals`
  ADD COLUMN `descriptionKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `currentBaselineKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `constraintsKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `finalRewardKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `checkins`
  ADD COLUMN `contentKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `studyMoodKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `difficultyLevelKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `score_appeals`
  ADD COLUMN `reasonKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `addedFactsKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `reward_cards`
  ADD COLUMN `descriptionKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `failure_reports`
  ADD COLUMN `reasonAnalysisKeyVersion` VARCHAR(191) NULL,
  ADD COLUMN `suggestionKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `audit_logs`
  ADD COLUMN `reasonKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `membership_audits`
  ADD COLUMN `reasonKeyVersion` VARCHAR(191) NULL;

ALTER TABLE `wechat_bindings`
  DROP INDEX `wechat_bindings_openId_key`,
  DROP INDEX `wechat_bindings_unionId_key`,
  ADD UNIQUE INDEX `wechat_bindings_openIdHash_key`(`openIdHash`),
  ADD UNIQUE INDEX `wechat_bindings_unionIdHash_key`(`unionIdHash`);

-- AlterTable
ALTER TABLE `checkins` ADD COLUMN `completedSubtasks` JSON NULL,
    ADD COLUMN `actualQuestionCount` INTEGER NULL,
    ADD COLUMN `correctQuestionCount` INTEGER NULL,
    ADD COLUMN `accuracy` INTEGER NULL,
    ADD COLUMN `evidenceFiles` JSON NULL,
    ADD COLUMN `evidenceLinks` JSON NULL,
    ADD COLUMN `studyMood` VARCHAR(191) NULL,
    ADD COLUMN `difficultyLevel` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `daily_tasks` ADD COLUMN `chapterRef` TEXT NULL,
    ADD COLUMN `evidenceRequired` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `materialRef` TEXT NULL,
    ADD COLUMN `priority` INTEGER NULL,
    ADD COLUMN `questionCount` INTEGER NULL,
    ADD COLUMN `studyTaskType` VARCHAR(191) NULL,
    ADD COLUMN `subject` VARCHAR(191) NULL,
    ADD COLUMN `targetAccuracy` INTEGER NULL;

-- AlterTable
ALTER TABLE `goals` ADD COLUMN `chapters` JSON NULL,
    ADD COLUMN `currentScore` VARCHAR(191) NULL,
    ADD COLUMN `dailyStudyMinutes` INTEGER NULL,
    ADD COLUMN `examDate` DATETIME(3) NULL,
    ADD COLUMN `examName` VARCHAR(191) NULL,
    ADD COLUMN `materials` JSON NULL,
    ADD COLUMN `mockExamFrequency` VARCHAR(191) NULL,
    ADD COLUMN `studyDaysPerWeek` INTEGER NULL,
    ADD COLUMN `subjects` JSON NULL,
    ADD COLUMN `targetScore` VARCHAR(191) NULL,
    ADD COLUMN `weaknesses` JSON NULL,
    MODIFY `category` ENUM('STUDY', 'CAREER', 'FITNESS', 'HABIT', 'CUSTOM', 'POSTGRAD_EXAM', 'CET_4_6', 'IELTS_TOEFL', 'GPA_IMPROVEMENT', 'CERTIFICATION', 'CUSTOM_STUDY') NOT NULL DEFAULT 'CUSTOM';

-- CreateIndex
CREATE INDEX `daily_tasks_goalId_studyTaskType_idx` ON `daily_tasks`(`goalId`, `studyTaskType`);

-- CreateIndex
CREATE INDEX `daily_tasks_goalId_subject_idx` ON `daily_tasks`(`goalId`, `subject`);

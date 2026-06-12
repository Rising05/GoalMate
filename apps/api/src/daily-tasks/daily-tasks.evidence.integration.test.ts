import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { DailyTasksService } from "./daily-tasks.service";

loadEnv();

const TEST_EMAIL_PREFIX = "checkin-evidence-integration-";

const prisma = new PrismaService();
const dailyTasksService = new DailyTasksService(prisma);

describe("DailyTasksService check-in evidence integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("stores study evidence and returns only basic AI scoring for free users", async () => {
    const { user, task } = await createExecutableTask("free", "FREE");
    const result = await dailyTasksService.completeTask(user.id, task.id, {
      content: "完成内容：做完阅读理解并整理错题。",
      investedMinutes: 45,
      completedSubtasks: ["阅读第 2 章", "整理 3 道错题"],
      actualQuestionCount: 20,
      correctQuestionCount: 16,
      evidenceFiles: ["https://example.com/proof.png"],
      evidenceLinks: ["https://example.com/error-book"],
      studyMood: "专注",
      difficultyLevel: "MEDIUM"
    });
    const checkin = await prisma.checkin.findUniqueOrThrow({
      where: { id: result.checkin.id }
    });
    const job = await prisma.aiJob.findUniqueOrThrow({
      where: { id: result.job.id }
    });
    const scoreEvidence = result.checkin.aiScore!.evidence;

    assert.deepEqual(result.checkin.completedSubtasks, [
      "阅读第 2 章",
      "整理 3 道错题"
    ]);
    assert.equal(result.checkin.actualQuestionCount, 20);
    assert.equal(result.checkin.correctQuestionCount, 16);
    assert.equal(result.checkin.accuracy, 80);
    assert.deepEqual(result.checkin.evidenceFiles, ["https://example.com/proof.png"]);
    assert.deepEqual(result.checkin.evidenceLinks, [
      "https://example.com/error-book"
    ]);
    assert.equal(result.checkin.studyMood, "专注");
    assert.equal(result.checkin.difficultyLevel, "MEDIUM");
    assert.equal(checkin.accuracy, 80);
    assert.deepEqual(checkin.evidenceLinks, ["https://example.com/error-book"]);
    assert.equal(result.checkin.aiScore!.isDetailedAnalysisUnlocked, false);
    assert.equal(result.checkin.aiScore!.analysisLevel, "BASIC");
    assert.equal(result.checkin.aiScore!.dimensions, null);
    assert.equal(scoreEvidence, null);
    assert.equal(result.checkin.aiScore!.summary, null);
    assert.equal(result.checkin.aiScore!.suggestion, null);
    assert.equal((job.payload as { analysisAccess?: string }).analysisAccess, "BASIC");
    assert.equal(
      (job.payload as { evidenceSummary?: { accuracy?: number } }).evidenceSummary
        ?.accuracy,
      80
    );
  });

  it("unlocks detailed AI analysis for pro users", async () => {
    const { user, task } = await createExecutableTask("pro", "PRO");
    const result = await dailyTasksService.completeTask(user.id, task.id, {
      content: "完成内容：完成模考并复盘薄弱项，补充了错题链接。",
      investedMinutes: 60,
      completedSubtasks: "模考\n错题整理",
      actualQuestionCount: 30,
      correctQuestionCount: 27,
      evidenceLinks: "https://example.com/mock-review",
      studyMood: "稳定",
      difficultyLevel: "HARD"
    });
    const aiScore = result.checkin.aiScore!;

    assert.equal(result.checkin.accuracy, 90);
    assert.equal(aiScore.isDetailedAnalysisUnlocked, true);
    assert.equal(aiScore.analysisLevel, "PRO");
    assert.equal(typeof aiScore.totalScore, "number");
    assert.equal((aiScore.dimensions as { questionAccuracy?: number }).questionAccuracy, 90);
    assert.equal((aiScore.evidence as { accuracy?: number }).accuracy, 90);
    assert.match(aiScore.summary as string, /题量|正确率|复盘/);
    assert.match(aiScore.suggestion as string, /证据|错题|截图|笔记/);
  });

  it("rejects impossible question evidence and isolates task ownership", async () => {
    const { user, task } = await createExecutableTask("invalid", "PRO");
    const other = await createUser("other", "PRO");

    await assert.rejects(
      () =>
        dailyTasksService.completeTask(user.id, task.id, {
          content: "完成内容：题量数据有误。",
          actualQuestionCount: 10,
          correctQuestionCount: 11
        }),
      BadRequestException
    );

    await assert.rejects(
      () =>
        dailyTasksService.completeTask(other.id, task.id, {
          content: "完成内容：尝试完成他人的任务。",
          investedMinutes: 10
        }),
      NotFoundException
    );
  });
});

async function cleanupTestUsers() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    }
  });
}

async function createUser(scenario: string, plan: "FREE" | "PRO") {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Evidence ${scenario}`,
      membership: {
        create: {
          plan,
          status: "ACTIVE"
        }
      }
    }
  });
}

async function createExecutableTask(scenario: string, plan: "FREE" | "PRO") {
  const user = await createUser(scenario, plan);
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `证据打卡测试 ${scenario}`,
      description: "用于验证学习证据和 AI 分析付费点。",
      category: "POSTGRAD_EXAM",
      status: "ACTIVE",
      startDate: new Date("2026-06-10T00:00:00.000+08:00"),
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2
    }
  });
  const task = await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
      title: "阅读与刷题",
      description: "完成章节阅读、刷题和错题整理。",
      plannedMinutes: 45,
      studyTaskType: "PRACTICE",
      subject: "英语",
      materialRef: "真题册",
      chapterRef: "阅读理解",
      questionCount: 20,
      targetAccuracy: 80,
      evidenceRequired: true,
      status: "PENDING"
    }
  });

  return { user, goal, task };
}

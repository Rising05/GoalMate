import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { DailyTasksService } from "./daily-tasks.service";
import { MockScoringProvider } from "./mock-scoring.provider";
import { ScoreInput, ScoreResult, ScoringProvider } from "./scoring-provider";

loadEnv();

const TEST_EMAIL_PREFIX = "checkin-scoring-worker-";

const prisma = new PrismaService();

describe("DailyTasksService scoring worker integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("queues check-in scoring and processes it through the worker path", async () => {
    const previousAsync = process.env.CHECKIN_SCORING_ASYNC;
    const previousBullMq = process.env.BULLMQ_ENABLED;
    process.env.CHECKIN_SCORING_ASYNC = "true";
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();
    const service = new DailyTasksService(
      prisma,
      new MockScoringProvider(),
      queueService
    );
    const { user, task } = await createExecutableTask("success");

    try {
      const completed = await service.completeTask(user.id, task.id, {
        content: "完成阅读和错题复盘，记录了薄弱章节。",
        investedMinutes: 55,
        completedSubtasks: ["阅读", "错题复盘"],
        actualQuestionCount: 20,
        correctQuestionCount: 17,
        evidenceLinks: ["https://example.com/wrong-notes"],
        studyMood: "专注",
        difficultyLevel: "MEDIUM"
      });
      const queuedCheckin = await prisma.checkin.findUniqueOrThrow({
        where: { id: completed.checkin.id },
        include: { aiScore: true }
      });
      const processed = await service.processQueuedCheckinScoringJob(
        completed.job.id
      );
      const rescoredCheckin = await prisma.checkin.findUniqueOrThrow({
        where: { id: completed.checkin.id },
        include: { aiScore: true }
      });
      const repeated = await service.processQueuedCheckinScoringJob(
        completed.job.id
      );

      assert.equal(completed.job.status, "QUEUED");
      assert.equal(queuedCheckin.status, "SCORING");
      assert.equal(queuedCheckin.aiScore, null);
      assert.equal(processed.processed, true);
      assert.equal(processed.job.status, "SUCCEEDED");
      assert.ok(processed.checkin?.aiScore);
      assert.equal(rescoredCheckin.status, "SCORED");
      assert.ok(rescoredCheckin.aiScore);
      assert.equal(repeated.processed, false);
    } finally {
      await queueService.onModuleDestroy();
      restoreEnv("CHECKIN_SCORING_ASYNC", previousAsync);
      restoreEnv("BULLMQ_ENABLED", previousBullMq);
    }
  });

  it("marks queued check-in scoring as failed when the provider fails", async () => {
    const previousAsync = process.env.CHECKIN_SCORING_ASYNC;
    const previousBullMq = process.env.BULLMQ_ENABLED;
    process.env.CHECKIN_SCORING_ASYNC = "true";
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();
    const service = new DailyTasksService(
      prisma,
      new FailingScoringProvider(),
      queueService
    );
    const { user, task } = await createExecutableTask("failure");

    try {
      const completed = await service.completeTask(user.id, task.id, {
        content: "提交一次会触发评分失败的复盘。",
        investedMinutes: 20
      });
      const processed = await service.processQueuedCheckinScoringJob(
        completed.job.id
      );
      const failedCheckin = await prisma.checkin.findUniqueOrThrow({
        where: { id: completed.checkin.id },
        include: { aiScore: true }
      });

      assert.equal(processed.processed, true);
      assert.equal(processed.job.status, "FAILED");
      assert.match(processed.job.error ?? "", /simulated scoring failure/);
      assert.equal(failedCheckin.status, "SCORE_FAILED");
      assert.equal(failedCheckin.aiScore, null);
    } finally {
      await queueService.onModuleDestroy();
      restoreEnv("CHECKIN_SCORING_ASYNC", previousAsync);
      restoreEnv("BULLMQ_ENABLED", previousBullMq);
    }
  });
});

class FailingScoringProvider implements ScoringProvider {
  readonly name = "failing-scorer";

  score(_input: ScoreInput): ScoreResult {
    throw new Error("simulated scoring failure");
  }
}

async function cleanupTestUsers() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    }
  });
}

async function createExecutableTask(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Scoring worker ${scenario}`
    }
  });
  const today = toBeijingDate(toDateKey(new Date()));
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `异步评分测试 ${scenario}`,
      description: "用于验证 CHECKIN_SCORING worker。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: today,
      endDate: addDays(today, 14),
      dailyTimeBudgetMinutes: 45,
      toleranceDaysAllowed: 2
    }
  });
  const task = await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: today,
      title: `异步评分任务 ${scenario}`,
      description: "完成后进入异步评分队列。",
      plannedMinutes: 45,
      questionCount: 20,
      targetAccuracy: 80,
      status: "PENDING"
    }
  });

  return { user, goal, task };
}

function restoreEnv(key: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

function toDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function toBeijingDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000+08:00`);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + days);
  return next;
}

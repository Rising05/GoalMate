import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { DailyTasksService } from "./daily-tasks.service";

loadEnv();

const TEST_EMAIL_PREFIX = "score-appeal-integration-";

const prisma = new PrismaService();
const dailyTasksService = new DailyTasksService(prisma);

describe("DailyTasksService score appeal integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("rescoring accepts appeals with new concrete evidence", async () => {
    const { user, task } = await createExecutableTask("accepted");
    const completed = await dailyTasksService.completeTask(user.id, task.id, {
      content: "完成内容：做了一个小练习。",
      investedMinutes: 10
    });
    const scoringJob = await prisma.aiJob.findUniqueOrThrow({
      where: { id: completed.job.id }
    });
    const originalScore = completed.checkin.aiScore!.totalScore;

    assert.equal(
      (scoringJob.payload as { provider?: string }).provider,
      "mock-scorer"
    );
    assert.equal(
      ((scoringJob.payload as { queue?: { queueName?: string } }).queue)
        ?.queueName,
      "ai-jobs"
    );
    const result = await dailyTasksService.appealCheckinScore(
      user.id,
      completed.checkin.id,
      {
        reason: "原复盘遗漏了关键完成证据。",
        addedFacts:
          "新增事实：补充截图链接 https://example.com/proof.png，并记录完成了 3 个练习题和 20 分钟整理笔记的数据。"
      }
    );

    assert.equal(result.appeal.status, "RESCORED");
    assert.ok(result.appeal.newScore! > originalScore);
    assert.equal(result.checkin.aiScore!.totalScore, result.appeal.newScore);
    assert.equal(result.checkin.id, completed.checkin.id);
    assert.equal(result.job.type, "CHECKIN_SCORE_APPEAL");
  });

  it("keeps the original score when appeal lacks new facts", async () => {
    const { user, task } = await createExecutableTask("rejected");
    const completed = await dailyTasksService.completeTask(user.id, task.id, {
      content: "完成内容：今天推进了一点。",
      investedMinutes: 8
    });
    const originalScore = completed.checkin.aiScore!.totalScore;

    const result = await dailyTasksService.appealCheckinScore(
      user.id,
      completed.checkin.id,
      {
        reason: "我觉得应该更高分。",
        addedFacts: "今天确实做了，但没有新增证据。"
      }
    );

    assert.equal(result.appeal.status, "APPEAL_REJECTED");
    assert.equal(result.appeal.newScore, originalScore);
    assert.equal(result.checkin.aiScore!.totalScore, originalScore);
  });

  it("rejects appeals without enough added facts", async () => {
    const { user, task } = await createExecutableTask("invalid");
    const completed = await dailyTasksService.completeTask(user.id, task.id, {
      content: "完成内容：完成基础动作。",
      investedMinutes: 8
    });

    await assert.rejects(
      () =>
        dailyTasksService.appealCheckinScore(user.id, completed.checkin.id, {
          reason: "复评",
          addedFacts: "无"
        }),
      BadRequestException
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

async function createExecutableTask(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Appeal ${scenario}`
    }
  });
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `评分申诉测试 ${scenario}`,
      description: "用于验证评分申诉复评。",
      category: "STUDY",
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
      title: "今日任务",
      description: "用于提交复盘并申诉评分。",
      plannedMinutes: 30,
      status: "PENDING"
    }
  });

  return { user, goal, task };
}

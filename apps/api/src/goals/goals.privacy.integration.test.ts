import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { GoalsService } from "./goals.service";

loadEnv();

const TEST_EMAIL_PREFIX = "goal-privacy-integration-";

const prisma = new PrismaService();
const goalsService = new GoalsService(prisma);

describe("GoalsService privacy deletion integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("deletes an owned goal and cascades its private goal data", async () => {
    const { user, goal, task, checkin } = await createGoalWithPrivateData("owned");
    await prisma.emailLog.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        type: "DAILY_TASK",
        recipientEmail: user.email,
        subject: "目标提醒",
        content: "含目标引用的提醒日志。",
        status: "QUEUED"
      }
    });
    const upload = await prisma.uploadAsset.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        fileName: "goal-delete-proof.png",
        mimeType: "image/png",
        sizeBytes: 68,
        storageProvider: "LOCAL",
        objectKey: `evidence/${user.id}/goal-delete-proof`
      }
    });

    const result = await goalsService.deleteGoal(user.id, goal.id);
    const [storedGoal, taskCount, checkinCount, scoreCount, eventCount, emailLog] =
      await Promise.all([
        prisma.goal.findUnique({ where: { id: goal.id } }),
        prisma.dailyTask.count({ where: { goalId: goal.id } }),
        prisma.checkin.count({ where: { goalId: goal.id } }),
        prisma.aiScore.count({ where: { checkinId: checkin.id } }),
        prisma.deviationEvent.count({ where: { goalId: goal.id } }),
        prisma.emailLog.findFirst({ where: { userId: user.id } })
      ]);

    assert.equal(result.deletedGoalId, goal.id);
    assert.equal(result.objectDeletionsScheduled, 1);
    assert.equal(storedGoal, null);
    assert.equal(taskCount, 0);
    assert.equal(checkinCount, 0);
    assert.equal(scoreCount, 0);
    assert.equal(eventCount, 0);
    const deletionJob = await prisma.objectDeletionJob.findFirstOrThrow({ where: { sourceType: "GOAL_DELETION", objectKey: upload.objectKey } });
    assert.equal(deletionJob.status, "QUEUED");
    assert.equal(emailLog?.goalId, null);
    assert.equal(task.goalId, goal.id);
  });

  it("rejects deleting another user's goal", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const goal = await createGoal(owner.id, "他人的目标");

    await assert.rejects(
      () => goalsService.deleteGoal(other.id, goal.id),
      NotFoundException
    );

    const storedGoal = await prisma.goal.findUnique({ where: { id: goal.id } });
    assert.ok(storedGoal);
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

async function createGoalWithPrivateData(scenario: string) {
  const user = await createUser(scenario);
  const goal = await createGoal(user.id, `隐私删除目标 ${scenario}`);
  const task = await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
      title: "待删除任务",
      description: "用于验证目标删除级联。",
      plannedMinutes: 30,
      status: "DONE"
    }
  });
  const checkin = await prisma.checkin.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      dailyTaskId: task.id,
      status: "SCORED",
      content: "这是一条目标下的私人复盘。",
      investedMinutes: 30
    }
  });
  await prisma.aiScore.create({
    data: {
      checkinId: checkin.id,
      totalScore: 88,
      dimensions: { completion: 88 },
      evidence: { source: "privacy-test" },
      summary: "测试评分。",
      suggestion: "测试建议。"
    }
  });
  await prisma.deviationEvent.create({
    data: {
      goalId: goal.id,
      riskLevel: "warning",
      primaryReasonCode: "LOW_SCORE",
      reasons: [{ code: "LOW_SCORE" }],
      metrics: { averageScore: 60 }
    }
  });

  return { user, goal, task, checkin };
}

async function createUser(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Privacy ${scenario}`
    }
  });
}

async function createGoal(userId: string, title: string) {
  return prisma.goal.create({
    data: {
      userId,
      title,
      description: "用于验证目标隐私删除。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date("2026-06-01T00:00:00.000+08:00"),
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2
    }
  });
}

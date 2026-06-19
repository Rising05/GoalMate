import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { DailyTasksService } from "./daily-tasks.service";

loadEnv();

const TEST_EMAIL_PREFIX = "activity-integration-";

const prisma = new PrismaService();
const dailyTasksService = new DailyTasksService(prisma);

describe("DailyTasksService activity integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("computes heatmap intensity from score, completion rate, time, and health", async () => {
    const user = await createUser("weighted");
    const goal = await createGoal(user.id);
    const doneTask = await prisma.dailyTask.create({
      data: {
        goalId: goal.id,
        taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
        title: "高质量完成任务",
        description: "用于验证热力图综合评分。",
        plannedMinutes: 30,
        status: "DONE"
      }
    });
    await prisma.dailyTask.create({
      data: {
        goalId: goal.id,
        taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
        title: "未完成任务",
        description: "用于拉低完成比例。",
        plannedMinutes: 30,
        status: "PENDING"
      }
    });
    const checkin = await prisma.checkin.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        dailyTaskId: doneTask.id,
        status: "SCORED",
        content: "完成了高质量产出并提供证据。",
        investedMinutes: 50,
        submittedAt: new Date("2026-06-10T20:00:00.000+08:00")
      }
    });
    await prisma.aiScore.create({
      data: {
        checkinId: checkin.id,
        totalScore: 90,
        dimensions: {
          completion: 90
        },
        evidence: {
          source: "activity-test"
        },
        summary: "高质量完成。",
        suggestion: "继续保持。"
      }
    });

    const activity = await dailyTasksService.getYearActivity(
      user.id,
      "2026",
      goal.id
    );
    const day = activity.days.find((item) => item.date === "2026-06-10");

    assert.ok(day);
    assert.equal(day.completedTaskCount, 1);
    assert.equal(day.totalTaskCount, 2);
    assert.equal(day.completionRate, 50);
    assert.equal(day.averageScore, 90);
    assert.equal(day.investedMinutes, 50);
    assert.equal(day.plannedMinutes, 60);
    assert.equal(day.healthScore, 72);
    assert.equal(day.level, 3);
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

async function createUser(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Activity ${scenario}`,
      membership: { create: { plan: "PRO", status: "ACTIVE" } }
    }
  });
}

async function createGoal(userId: string) {
  return prisma.goal.create({
    data: {
      userId,
      title: "热力图综合评分目标",
      description: "用于验证热力图强度计算。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date("2026-06-01T00:00:00.000+08:00"),
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2
    }
  });
}

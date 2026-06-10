import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { AiJobsService } from "./ai-jobs.service";
import { MockPlanProvider } from "./mock-plan.provider";

loadEnv();

const TEST_EMAIL_PREFIX = "replan-integration-";

const prisma = new PrismaService();
const aiJobsService = new AiJobsService(prisma, new MockPlanProvider());

describe("AiJobsService requestGoalReplan integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("re-evaluates an active goal and creates a new plan version", async () => {
    const { user, goal } = await createActiveGoalWithPlan("active");

    const result = await aiJobsService.requestGoalReplan(user.id, goal.id, {
      adjustmentReason: "最近工作日时间被压缩，需要把每日任务缩小并重新安排节奏。",
      dailyTimeBudgetMinutes: 25,
      constraints: "每天只保留一个最小可完成动作。"
    });
    const latestGoal = await prisma.goal.findUniqueOrThrow({
      where: { id: goal.id }
    });
    const activeOldTasks = await prisma.dailyTask.count({
      where: {
        goalId: goal.id,
        title: "旧计划任务"
      }
    });

    assert.equal(result.job.type, "GOAL_PLAN_REPLAN");
    assert.equal(result.job.status, "SUCCEEDED");
    assert.equal(result.goal.status, "WAITING_CONFIRMATION");
    assert.equal(result.plan?.version, 2);
    assert.equal(result.plan?.isActive, false);
    assert.equal(latestGoal.dailyTimeBudgetMinutes, 25);
    assert.equal(latestGoal.constraints, "每天只保留一个最小可完成动作。");
    assert.equal(activeOldTasks, 0);
  });

  it("requires a concrete adjustment reason", async () => {
    const { user, goal } = await createActiveGoalWithPlan("reject");

    await assert.rejects(
      () =>
        aiJobsService.requestGoalReplan(user.id, goal.id, {
          adjustmentReason: "太忙"
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

async function createActiveGoalWithPlan(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Replan ${scenario}`
    }
  });
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `计划调整 ${scenario}`,
      description: "用于验证执行中计划调整。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date("2026-06-10T00:00:00.000+08:00"),
      endDate: new Date("2026-06-24T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2,
      dailyTimeBudgetMinutes: 45
    }
  });
  const plan = await prisma.plan.create({
    data: {
      goalId: goal.id,
      version: 1,
      summary: "旧计划",
      isActive: true,
      confirmedAt: new Date("2026-06-10T08:00:00.000+08:00")
    }
  });
  const weeklyPlan = await prisma.weeklyPlan.create({
    data: {
      planId: plan.id,
      weekIndex: 1,
      title: "旧周计划",
      summary: "旧周计划摘要",
      startsOn: new Date("2026-06-10T00:00:00.000+08:00"),
      endsOn: new Date("2026-06-16T00:00:00.000+08:00")
    }
  });

  await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      weeklyPlanId: weeklyPlan.id,
      taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
      title: "旧计划任务",
      description: "会在重新规划时被替换。",
      plannedMinutes: 45,
      status: "PENDING"
    }
  });

  return { user, goal };
}

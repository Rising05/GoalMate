import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
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

  it("retries AI plan generation before succeeding", async () => {
    const provider = new FlakyPlanProvider(2);
    const service = new AiJobsService(prisma, provider);
    const user = await createUser("retry-success");
    const goal = await createDraftGoal(user.id, "重试成功目标");

    const result = await service.generateGoalPlan(user.id, goal.id);

    assert.equal(result.job.status, "SUCCEEDED");
    assert.equal(result.job.attempts, 3);
    assert.equal((result.job.payload as { provider?: string }).provider, "mock");
    assert.equal(provider.calls, 3);
    assert.equal(result.goal.status, "WAITING_CONFIRMATION");
    assert.ok(result.plan);
  });

  it("returns AI job status only to the owning user", async () => {
    const user = await createUser("job-status-owner");
    const otherUser = await createUser("job-status-other");
    const goal = await createDraftGoal(user.id, "任务状态查询目标");
    const result = await aiJobsService.generateGoalPlan(user.id, goal.id);

    const ownJob = await aiJobsService.getJob(user.id, result.job.id);

    assert.equal(ownJob.job.id, result.job.id);
    assert.equal(ownJob.job.status, "SUCCEEDED");
    assert.equal((ownJob.job.payload as { provider?: string }).provider, "mock");
    await assert.rejects(
      () => aiJobsService.getJob(otherUser.id, result.job.id),
      NotFoundException
    );
  });

  it("marks AI plan generation as failed after max retries", async () => {
    const provider = new FlakyPlanProvider(3);
    const service = new AiJobsService(prisma, provider);
    const user = await createUser("retry-failed");
    const goal = await createDraftGoal(user.id, "重试失败目标");

    const result = await service.generateGoalPlan(user.id, goal.id);
    const storedGoal = await prisma.goal.findUniqueOrThrow({
      where: { id: goal.id }
    });

    assert.equal(result.job.status, "FAILED");
    assert.equal(result.job.attempts, 3);
    assert.equal(provider.calls, 3);
    assert.equal(result.plan, null);
    assert.equal(storedGoal.status, "GENERATION_FAILED");
    assert.match(result.job.error ?? "", /模拟 AI 失败/);
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
  const user = await createUser(scenario);
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

async function createUser(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Replan ${scenario}`
    }
  });
}

async function createDraftGoal(userId: string, title: string) {
  return prisma.goal.create({
    data: {
      userId,
      title,
      description: "用于验证 AI 失败重试。",
      category: "STUDY",
      status: "DRAFT",
      startDate: new Date("2026-06-10T00:00:00.000+08:00"),
      endDate: new Date("2026-06-24T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2,
      dailyTimeBudgetMinutes: 45
    }
  });
}

class FlakyPlanProvider extends MockPlanProvider {
  calls = 0;

  constructor(private readonly failuresBeforeSuccess: number) {
    super();
  }

  override generate(goal: Parameters<MockPlanProvider["generate"]>[0]) {
    this.calls += 1;

    if (this.calls <= this.failuresBeforeSuccess) {
      throw new Error(`模拟 AI 失败 ${this.calls}`);
    }

    return super.generate(goal);
  }
}

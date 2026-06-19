import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { AiJobsService } from "./ai-jobs.service";
import { MockPlanProvider } from "./mock-plan.provider";

loadEnv();

const TEST_EMAIL_PREFIX = "quota-integration-";

const prisma = new PrismaService();
const aiJobsService = new AiJobsService(prisma, new MockPlanProvider());

describe("AiJobsService active goal quota integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("blocks free users from confirming a second active goal", async () => {
    const user = await createUser("free-block", "FREE");
    await createGoal(user.id, "已执行目标", "ACTIVE");
    const waitingGoal = await createGoal(user.id, "待确认目标", "WAITING_CONFIRMATION");
    await createPlan(waitingGoal.id);

    await assert.rejects(
      () => aiJobsService.confirmGoalPlan(user.id, waitingGoal.id),
      HttpException
    );
  });

  it("allows pro users to confirm multiple active goals", async () => {
    const user = await createUser("pro-allow", "PRO");
    for (let index = 1; index <= 6; index += 1) {
      await createGoal(user.id, `已执行目标 ${index}`, "ACTIVE");
    }
    const waitingGoal = await createGoal(user.id, "会员待确认目标", "WAITING_CONFIRMATION");
    await createPlan(waitingGoal.id);

    const result = await aiJobsService.confirmGoalPlan(user.id, waitingGoal.id);

    assert.equal(result.goal.status, "ACTIVE");
    assert.equal(result.plan.isActive, true);
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
      displayName: `Quota ${scenario}`,
      membership: {
        create: {
          plan,
          status: "ACTIVE"
        }
      }
    }
  });
}

async function createGoal(
  userId: string,
  title: string,
  status: "ACTIVE" | "WAITING_CONFIRMATION"
) {
  return prisma.goal.create({
    data: {
      userId,
      title,
      description: "用于验证会员额度限制。",
      category: "STUDY",
      status,
      startDate: new Date("2026-06-10T00:00:00.000+08:00"),
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2
    }
  });
}

async function createPlan(goalId: string) {
  return prisma.plan.create({
    data: {
      goalId,
      version: 1,
      summary: "会员额度测试计划",
      isActive: false
    }
  });
}

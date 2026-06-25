import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { GoalsService } from "./goals.service";
import { PrismaService } from "../prisma/prisma.service";

loadEnv();

const TEST_EMAIL_PREFIX = "milestones-integration-";
const prisma = new PrismaService();
const goalsService = new GoalsService(prisma);

describe("GoalsService.setMilestoneCompletion integration", () => {
  before(cleanup);
  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("marks a milestone complete and writes a runtime MILESTONE_REACHED event", async () => {
    const { user, goal, milestone } = await createGoalWithMilestone("complete");

    const result = await goalsService.setMilestoneCompletion(
      user.id,
      goal.id,
      milestone.id,
      { completed: true }
    );

    assert.equal(result.changed, true);
    assert.equal(result.completed, true);
    assert.equal(result.milestone.isCompleted, true);

    const event = await prisma.growthEvent.findFirst({
      where: {
        userId: user.id,
        goalId: goal.id,
        type: "MILESTONE_REACHED",
        sourceResourceId: milestone.id
      }
    });
    assert.ok(event);
    assert.equal(event.derived, false);
    assert.equal((event.metadata as { title: string }).title, milestone.title);
  });

  it("is idempotent when toggling to the same state", async () => {
    const { user, goal, milestone } = await createGoalWithMilestone("idempotent");
    await goalsService.setMilestoneCompletion(user.id, goal.id, milestone.id, {
      completed: true
    });

    const repeated = await goalsService.setMilestoneCompletion(
      user.id,
      goal.id,
      milestone.id,
      { completed: true }
    );

    assert.equal(repeated.changed, false);
    assert.equal(repeated.completed, true);

    const eventCount = await prisma.growthEvent.count({
      where: {
        userId: user.id,
        goalId: goal.id,
        type: "MILESTONE_REACHED",
        sourceResourceId: milestone.id
      }
    });
    assert.equal(eventCount, 1);
  });

  it("toggles completion by default and removes the event when uncompleted", async () => {
    const { user, goal, milestone } = await createGoalWithMilestone("toggle");
    await goalsService.setMilestoneCompletion(user.id, goal.id, milestone.id);

    const toggledBack = await goalsService.setMilestoneCompletion(
      user.id,
      goal.id,
      milestone.id,
      { completed: false }
    );

    assert.equal(toggledBack.changed, true);
    assert.equal(toggledBack.completed, false);

    const remaining = await prisma.growthEvent.count({
      where: {
        userId: user.id,
        goalId: goal.id,
        type: "MILESTONE_REACHED",
        sourceResourceId: milestone.id
      }
    });
    assert.equal(remaining, 0);
  });

  it("rejects cross-user milestone access", async () => {
    const owner = await createGoalWithMilestone("owner-cross");
    const intruder = await createUser("intruder-cross");

    await assert.rejects(
      goalsService.setMilestoneCompletion(intruder.id, owner.goal.id, owner.milestone.id, {
        completed: true
      }),
      /目标不存在/
    );
  });
});

async function cleanup() {
  await prisma.user.deleteMany({
    where: {
      email: { startsWith: TEST_EMAIL_PREFIX }
    }
  });
}

async function createUser(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Milestone ${scenario}`
    }
  });
}

async function createGoalWithMilestone(scenario: string) {
  const user = await createUser(scenario);
  const startDate = new Date("2026-06-24T00:00:00.000+08:00");
  const endDate = new Date("2026-07-24T00:00:00.000+08:00");
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `里程碑目标 ${scenario}`,
      description: "用于验证里程碑完成会写入统一成长事件。",
      category: "STUDY",
      status: "ACTIVE",
      startDate,
      endDate,
      dailyTimeBudgetMinutes: 60,
      toleranceDaysAllowed: 3
    }
  });
  const milestone = await prisma.milestone.create({
    data: {
      goalId: goal.id,
      title: `里程碑 ${scenario}`,
      description: "阶段检查点",
      targetDate: new Date("2026-07-10T00:00:00.000+08:00"),
      rewardText: "休息一天"
    }
  });

  return { user, goal, milestone };
}

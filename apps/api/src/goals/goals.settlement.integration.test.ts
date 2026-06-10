import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { GoalsService } from "./goals.service";

loadEnv();

const TEST_EMAIL_PREFIX = "goal-settlement-integration-";

const prisma = new PrismaService();
const goalsService = new GoalsService(prisma);

describe("GoalsService settlement integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("fails an active goal after tolerance is exceeded and creates a failure report", async () => {
    const { goal, user } = await createGoalForSettlement("failure", {
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 1
    });

    await createPendingTask(goal.id, "2026-06-08", "第一次断签");
    await createPendingTask(goal.id, "2026-06-09", "第二次断签");
    await createLowScoreCheckin(user.id, goal.id, "2026-06-07");
    await prisma.deviationEvent.create({
      data: {
        goalId: goal.id,
        riskLevel: "danger",
        primaryReasonCode: "TASK_DELAY",
        primaryReasonLabel: "任务延期",
        primaryReasonDetail: "已有历史任务未完成。",
        reasons: [
          {
            code: "TASK_DELAY",
            level: "danger",
            label: "任务延期",
            detail: "已有历史任务未完成。"
          }
        ],
        metrics: {
          overdueTaskCount: 2
        }
      }
    });

    const result = await goalsService.settleGoal(user.id, goal.id);

    assert.equal(result.goal.status, "FAILED");
    assert.equal(result.goal.toleranceDaysUsed, 2);
    assert.equal(result.settlement.reachedEndDate, false);
    assert.ok(result.failureReport);
    assert.equal(result.failureReport.goalId, goal.id);
    assert.equal(result.failureReport.brokenStreakTimeline.length, 2);
    assert.equal(result.failureReport.lowScoreTasks.length, 1);
    assert.equal(result.failureReport.keyDeviationNodes.length, 1);
    assert.match(result.failureReport.suggestion, /重新开启一个更小的新目标/);
  });

  it("restarts a failed goal as a new draft goal", async () => {
    const { goal, user } = await createGoalForSettlement("restart", {
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 0
    });

    await createPendingTask(goal.id, "2026-06-09", "断签任务");
    await goalsService.settleGoal(user.id, goal.id);

    const restarted = await goalsService.restartGoal(user.id, goal.id, {
      title: "重新开启目标",
      startDate: "2026-06-10",
      endDate: "2026-06-20",
      dailyTimeBudgetMinutes: 20,
      toleranceDaysAllowed: 2
    });

    assert.notEqual(restarted.goal.id, goal.id);
    assert.equal(restarted.sourceGoalId, goal.id);
    assert.equal(restarted.goal.status, "DRAFT");
    assert.equal(restarted.goal.title, "重新开启目标");
    assert.equal(restarted.goal.dailyTimeBudgetMinutes, 20);
    assert.equal(restarted.goal.toleranceDaysAllowed, 2);
  });

  it("rejects restarting a goal that has not failed", async () => {
    const { goal, user } = await createGoalForSettlement("restart-reject", {
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2
    });

    await assert.rejects(
      () => goalsService.restartGoal(user.id, goal.id, {}),
      BadRequestException
    );
  });

  it("completes an ended goal when tolerance has not been exceeded", async () => {
    const { goal, user } = await createGoalForSettlement("completion", {
      endDate: new Date("2026-06-09T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2
    });

    await createPendingTask(goal.id, "2026-06-08", "可容错断签");

    const result = await goalsService.settleGoal(user.id, goal.id);

    assert.equal(result.goal.status, "COMPLETED");
    assert.equal(result.goal.toleranceDaysUsed, 1);
    assert.equal(result.settlement.reachedEndDate, true);
    assert.equal(result.failureReport, null);
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

async function createGoalForSettlement(
  scenario: string,
  input: {
    endDate: Date;
    toleranceDaysAllowed: number;
  }
) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Settlement ${scenario}`
    }
  });
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `结算测试 ${scenario}`,
      description: "用于验证目标失败、完成和重新开启。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date("2026-06-01T00:00:00.000+08:00"),
      endDate: input.endDate,
      toleranceDaysAllowed: input.toleranceDaysAllowed,
      dailyTimeBudgetMinutes: 30,
      currentBaseline: "已有基础",
      constraints: "每天只做小步推进",
      finalReward: "完成后休息一天"
    }
  });

  return { user, goal };
}

async function createPendingTask(goalId: string, dateKey: string, title: string) {
  return prisma.dailyTask.create({
    data: {
      goalId,
      taskDate: toBeijingDate(dateKey),
      title,
      description: "保持未完成，用于消耗容错。",
      plannedMinutes: 30,
      status: "PENDING"
    }
  });
}

async function createLowScoreCheckin(userId: string, goalId: string, dateKey: string) {
  const task = await prisma.dailyTask.create({
    data: {
      goalId,
      taskDate: toBeijingDate(dateKey),
      title: "低分任务",
      description: "用于生成失败报告低分任务列表。",
      plannedMinutes: 30,
      status: "DONE"
    }
  });
  const checkin = await prisma.checkin.create({
    data: {
      userId,
      goalId,
      dailyTaskId: task.id,
      status: "SCORED",
      content: "完成了但证据不足。",
      investedMinutes: 10,
      submittedAt: new Date(`${dateKey}T20:00:00.000+08:00`)
    }
  });

  await prisma.aiScore.create({
    data: {
      checkinId: checkin.id,
      totalScore: 62,
      dimensions: {
        completion: 62
      },
      evidence: {
        source: "test"
      },
      summary: "完成质量偏低。",
      suggestion: "补充可验证成果。"
    }
  });
}

function toBeijingDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000+08:00`);
}

import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DailyTasksService } from "../daily-tasks/daily-tasks.service";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { GoalsService } from "./goals.service";

loadEnv();

const TEST_EMAIL_PREFIX = "rescue-integration-";
const TIMEZONE = "Asia/Shanghai";

const prisma = new PrismaService();
const goalsService = new GoalsService(prisma);
const dailyTasksService = new DailyTasksService(prisma);

describe("GoalsService.generateRescueTask integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("creates a deviation event when the goal has a deviation", async () => {
    const { goal } = await createActiveGoalWithTodayTask("creates-event");

    const result = await goalsService.generateRescueTask(goal.userId, goal.id);
    const event = await prisma.deviationEvent.findUnique({
      where: { id: result.deviation.eventId! }
    });

    assert.equal(result.deviation.riskLevel, "danger");
    assert.equal(result.deviation.reasons[0]?.code, "LOW_INVESTMENT");
    assert.ok(result.deviation.eventId);
    assert.ok(event);
    assert.equal(event.goalId, goal.id);
    assert.equal(event.primaryReasonCode, "LOW_INVESTMENT");
    assert.equal(result.rescueTask.taskType, "RESCUE");
    assert.equal(result.rescueTask.deviationEventId, event.id);
  });

  it("reuses the same-day deviation event for the same primary reason", async () => {
    const { goal } = await createActiveGoalWithTodayTask("reuses-event");

    const first = await goalsService.generateRescueTask(goal.userId, goal.id);
    assert.ok(first.deviation.eventId);

    await prisma.dailyTask.update({
      where: { id: first.rescueTask.id },
      data: { status: "DONE" }
    });

    const second = await goalsService.generateRescueTask(goal.userId, goal.id);
    const eventCount = await prisma.deviationEvent.count({
      where: { goalId: goal.id }
    });

    assert.equal(second.deviation.eventId, first.deviation.eventId);
    assert.equal(second.rescueTask.deviationEventId, first.deviation.eventId);
    assert.equal(eventCount, 1);
  });

  it("reuses a pending same-day rescue task and creates a new one after completion", async () => {
    const { goal } = await createActiveGoalWithTodayTask("reuses-task");

    const first = await goalsService.generateRescueTask(goal.userId, goal.id);
    const second = await goalsService.generateRescueTask(goal.userId, goal.id);

    assert.equal(second.rescueTask.id, first.rescueTask.id);
    assert.equal(second.rescueTask.status, "PENDING");
    assert.equal(second.rescueTask.deviationEventId, first.deviation.eventId);

    await dailyTasksService.completeTask(goal.userId, first.rescueTask.id, {
      content:
        "完成救援任务，补上一个最小推进动作，整理了明确证据，并记录明天回到原计划的恢复步骤。",
      investedMinutes: 30
    });

    const third = await goalsService.generateRescueTask(goal.userId, goal.id);
    const [rescueTaskCount, doneRescueTaskCount, pendingRescueTaskCount] =
      await prisma.$transaction([
        prisma.dailyTask.count({
          where: { goalId: goal.id, taskType: "RESCUE" }
        }),
        prisma.dailyTask.count({
          where: { goalId: goal.id, taskType: "RESCUE", status: "DONE" }
        }),
        prisma.dailyTask.count({
          where: { goalId: goal.id, taskType: "RESCUE", status: "PENDING" }
        })
      ]);

    assert.notEqual(third.rescueTask.id, first.rescueTask.id);
    assert.equal(third.rescueTask.deviationEventId, first.deviation.eventId);
    assert.equal(rescueTaskCount, 2);
    assert.equal(doneRescueTaskCount, 1);
    assert.equal(pendingRescueTaskCount, 1);
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

async function createActiveGoalWithTodayTask(scenario: string) {
  const todayKey = toDateKey(new Date());
  const startDate = toBeijingDate(todayKey);
  const endDate = addDays(startDate, 6);
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Rescue ${scenario}`
    }
  });
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `救援集成测试 ${scenario}`,
      description: "制造今日未完成和近 7 天低投入偏差信号。",
      category: "STUDY",
      status: "ACTIVE",
      startDate,
      endDate,
      dailyTimeBudgetMinutes: 60,
      toleranceDaysAllowed: 2
    }
  });
  const task = await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: startDate,
      title: "今日原计划任务",
      description: "保持未完成，用于触发断签和低投入偏差。",
      plannedMinutes: 60,
      status: "PENDING"
    }
  });

  return { user, goal, task };
}

function toDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
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

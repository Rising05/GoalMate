import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DailyTasksService } from "../daily-tasks/daily-tasks.service";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
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

  it("returns the deviation event, rescue task, and rescue review in the timeline", async () => {
    const { goal, task: sourceTask } =
      await createActiveGoalWithTodayTask("timeline-chain");

    const generated = await goalsService.generateRescueTask(goal.userId, goal.id);
    assert.ok(generated.deviation.eventId);

    const completed = await dailyTasksService.completeTask(
      goal.userId,
      generated.rescueTask.id,
      {
        content:
          "完成救援任务，补齐最小行动证据，并写下触发偏差后的恢复策略，明天按原计划继续推进。",
        investedMinutes: 32
      }
    );
    const timeline = await dailyTasksService.getTimeline(goal.userId, goal.id);
    const deviationItem = timeline.items.find(
      (item) =>
        item.kind === "DEVIATION" &&
        item.deviationEventId === generated.deviation.eventId
    );
    const rescueReviewItem = timeline.items.find(
      (item) =>
        item.kind === "CHECKIN" &&
        item.deviationEventId === generated.deviation.eventId
    );

    assert.ok(deviationItem);
    assert.equal(deviationItem.sourceDailyTaskId, sourceTask.id);
    assert.equal(deviationItem.sourceTask?.id, sourceTask.id);
    assert.equal(deviationItem.rescueRiskLevel, "danger");
    assert.equal(deviationItem.deviationReasons[0]?.code, "LOW_INVESTMENT");
    assert.equal(deviationItem.rescueTasks.length, 1);
    assert.equal(deviationItem.rescueTasks[0].id, generated.rescueTask.id);
    assert.equal(
      deviationItem.rescueTasks[0].deviationEventId,
      generated.deviation.eventId
    );
    assert.equal(deviationItem.rescueTasks[0].latestCheckin?.id, completed.checkin.id);
    assert.ok(deviationItem.rescueTasks[0].latestCheckin?.aiScore);
    assert.ok(deviationItem.aiScore);

    assert.ok(rescueReviewItem);
    assert.equal(rescueReviewItem.isRescueTask, true);
    assert.equal(rescueReviewItem.checkin?.id, completed.checkin.id);
    assert.equal(rescueReviewItem.aiScore?.totalScore, completed.checkin.aiScore?.totalScore);
  });

  it("queues rescue task generation and processes it through the worker path", async () => {
    const previousAsync = process.env.RESCUE_TASK_ASYNC;
    const previousBullMq = process.env.BULLMQ_ENABLED;
    process.env.RESCUE_TASK_ASYNC = "true";
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();
    const service = new GoalsService(prisma, queueService);
    const { goal } = await createActiveGoalWithTodayTask("async-worker");

    try {
      const queued = await service.generateRescueTask(goal.userId, goal.id);
      const queuedJob = await prisma.aiJob.findUniqueOrThrow({
        where: { id: queued.job.id }
      });
      const processed = await service.processQueuedRescueTaskJob(queued.job.id);
      const repeated = await service.processQueuedRescueTaskJob(queued.job.id);
      const storedJob = await prisma.aiJob.findUniqueOrThrow({
        where: { id: queued.job.id }
      });

      assert.equal(queued.rescueTask, null);
      assert.equal(queued.job.type, "RESCUE_TASK_GENERATION");
      assert.equal(queued.job.status, "QUEUED");
      assert.equal(
        (queuedJob.payload as { riskLevel?: string }).riskLevel,
        "danger"
      );
      assert.equal(
        (queuedJob.payload as { triggerCode?: string }).triggerCode,
        "LOW_INVESTMENT"
      );
      assert.equal(processed.processed, true);
      assert.equal(processed.job.status, "SUCCEEDED");
      assert.equal(processed.rescueTask?.taskType, "RESCUE");
      assert.equal(processed.rescueTask?.deviationEventId, queued.deviation.eventId);
      assert.equal(storedJob.status, "SUCCEEDED");
      assert.equal(
        (storedJob.result as { rescueTaskId?: string }).rescueTaskId,
        processed.rescueTask?.id
      );
      assert.equal(repeated.processed, false);
    } finally {
      await queueService.onModuleDestroy();
      restoreEnv("RESCUE_TASK_ASYNC", previousAsync);
      restoreEnv("BULLMQ_ENABLED", previousBullMq);
    }
  });

  it("falls back to rule rescue task generation when the rescue provider fails", async () => {
    const previousAsync = process.env.RESCUE_TASK_ASYNC;
    const previousBullMq = process.env.BULLMQ_ENABLED;
    process.env.RESCUE_TASK_ASYNC = "true";
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();
    const service = new GoalsService(prisma, queueService);
    const { goal } = await createActiveGoalWithTodayTask("async-fallback");

    try {
      const queued = await service.generateRescueTask(goal.userId, goal.id);
      const payload = await prisma.aiJob.findUniqueOrThrow({
        where: { id: queued.job.id },
        select: { payload: true }
      });
      await prisma.aiJob.update({
        where: { id: queued.job.id },
        data: {
          payload: {
            ...(payload.payload as Record<string, unknown>),
            simulateProviderFailure: true
          }
        }
      });

      const processed = await service.processQueuedRescueTaskJob(queued.job.id);
      const storedJob = await prisma.aiJob.findUniqueOrThrow({
        where: { id: queued.job.id }
      });

      assert.equal(processed.processed, true);
      assert.equal(processed.job.status, "SUCCEEDED");
      assert.equal((processed as { fallback?: boolean }).fallback, true);
      assert.equal(processed.rescueTask?.taskType, "RESCUE");
      assert.equal(
        (storedJob.result as { fallback?: boolean }).fallback,
        true
      );
      assert.match(storedJob.error ?? "", /simulated rescue provider failure/);
    } finally {
      await queueService.onModuleDestroy();
      restoreEnv("RESCUE_TASK_ASYNC", previousAsync);
      restoreEnv("BULLMQ_ENABLED", previousBullMq);
    }
  });

  it("keeps queued rescue task processing isolated by job owner", async () => {
    const owner = await createActiveGoalWithTodayTask("async-owner");
    const other = await createActiveGoalWithTodayTask("async-other");
    const job = await prisma.aiJob.create({
      data: {
        userId: owner.goal.userId,
        goalId: other.goal.id,
        type: "RESCUE_TASK_GENERATION",
        status: "QUEUED",
        payload: {
          goalId: other.goal.id,
          provider: "mock-rescue"
        }
      }
    });

    const processed = await goalsService.processQueuedRescueTaskJob(job.id);
    const otherRescueTaskCount = await prisma.dailyTask.count({
      where: {
        goalId: other.goal.id,
        taskType: "RESCUE"
      }
    });

    assert.equal(processed.processed, true);
    assert.equal(processed.job.status, "FAILED");
    assert.equal(otherRescueTaskCount, 0);
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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + days);
  return next;
}

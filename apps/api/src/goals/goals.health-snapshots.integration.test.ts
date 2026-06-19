import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { GoalsService } from "./goals.service";

loadEnv();

const TEST_EMAIL_PREFIX = "health-snapshot-integration-";
const TIMEZONE = "Asia/Shanghai";

const prisma = new PrismaService();
const goalsService = new GoalsService(prisma);

describe("GoalsService health snapshots integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("returns rescue metrics and upserts the daily health snapshot", async () => {
    const { goal, todayStart } = await createGoalWithHealthSignals("metrics");

    const first = await goalsService.getGoalHealth(goal.userId, goal.id);
    const second = await goalsService.getGoalHealth(goal.userId, goal.id);
    const snapshots = await prisma.healthSnapshot.findMany({
      where: {
        goalId: goal.id
      }
    });
    const trend = await goalsService.listHealthSnapshots(goal.userId, goal.id);

    assert.equal(first.rescueSuccessCount7d, 1);
    assert.equal(first.rescueTaskCompletionRate, 100);
    assert.equal(first.normalTaskCompletionRate, 50);
    assert.equal(first.rescueNextDayRecovered, true);
    assert.equal(first.completionMetrics.recentNormalTaskCount, 2);
    assert.equal(first.completionMetrics.recentNormalTaskCompletedCount, 1);
    assert.equal(first.rescueMetrics.lastCompletedRescueTaskId !== null, true);
    assert.equal(first.snapshot.date, toDateKey(todayStart));
    assert.equal(first.snapshot.healthScore, first.healthScore);
    assert.equal(second.snapshot.id, first.snapshot.id);
    assert.equal(snapshots.length, 1);
    assert.equal(trend.snapshots.length, 1);
    assert.equal(trend.snapshots[0].id, first.snapshot.id);
  });

  it("queues and processes a report worker health snapshot job", async () => {
    const previous = process.env.BULLMQ_ENABLED;
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();
    const service = new GoalsService(prisma, queueService);
    const { goal, todayStart } = await createGoalWithHealthSignals("report-worker");

    try {
      const queued = await service.enqueueHealthSnapshotReport(goal.userId, goal.id, {
        reportDate: toDateKey(todayStart)
      });
      const processed = await service.processQueuedReportJob({
        type: "HEALTH_SNAPSHOT",
        userId: goal.userId,
        goalId: goal.id,
        reportDate: toDateKey(todayStart)
      });
      const repeated = await service.processQueuedReportJob({
        type: "HEALTH_SNAPSHOT",
        userId: goal.userId,
        goalId: goal.id,
        reportDate: toDateKey(todayStart)
      });
      const snapshots = await prisma.healthSnapshot.findMany({
        where: { goalId: goal.id }
      });

      assert.equal(queued.report.type, "HEALTH_SNAPSHOT");
      assert.equal(queued.queue.queued, false);
      assert.equal(queued.queue.queueName, "reports");
      assert.equal(processed.processed, true);
      assert.ok(processed.snapshot);
      assert.ok(repeated.snapshot);
      assert.equal(processed.snapshot.date, toDateKey(todayStart));
      assert.equal(processed.snapshot.id, repeated.snapshot.id);
      assert.equal(snapshots.length, 1);
    } finally {
      await queueService.onModuleDestroy();

      if (previous === undefined) {
        delete process.env.BULLMQ_ENABLED;
      } else {
        process.env.BULLMQ_ENABLED = previous;
      }
    }
  });

  it("builds weekly trend reports and processes them through the report worker path", async () => {
    const previous = process.env.BULLMQ_ENABLED;
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();
    const service = new GoalsService(prisma, queueService);
    const { goal, todayStart } = await createGoalWithHealthSignals("weekly-trend");

    try {
      await prisma.healthSnapshot.createMany({
        data: [
          buildHealthSnapshot(goal.id, addDays(todayStart, -8), 50, "warning"),
          buildHealthSnapshot(goal.id, addDays(todayStart, -7), 60, "warning"),
          buildHealthSnapshot(goal.id, addDays(todayStart, -2), 70, "stable"),
          buildHealthSnapshot(goal.id, addDays(todayStart, -1), 80, "warning"),
          buildHealthSnapshot(goal.id, todayStart, 90, "danger")
        ]
      });

      const queued = await service.enqueueGoalReport(goal.userId, goal.id, {
        type: "WEEKLY_TREND",
        reportDate: toDateKey(todayStart)
      });
      const report = await service.getHealthTrendReport(goal.userId, goal.id, {
        type: "WEEKLY_TREND",
        reportDate: toDateKey(todayStart)
      });
      const processed = await service.processQueuedReportJob({
        type: "WEEKLY_TREND",
        userId: goal.userId,
        goalId: goal.id,
        reportDate: toDateKey(todayStart)
      });
      const repeatedProcessed = await service.processQueuedReportJob({
        type: "WEEKLY_TREND",
        userId: goal.userId,
        goalId: goal.id,
        reportDate: toDateKey(todayStart)
      });
      const monthlyReport = await service.getHealthTrendReport(goal.userId, goal.id, {
        type: "MONTHLY_TREND",
        reportDate: toDateKey(todayStart)
      });
      const monthlyProcessed = await service.processQueuedReportJob({
        type: "MONTHLY_TREND",
        userId: goal.userId,
        goalId: goal.id,
        reportDate: toDateKey(todayStart)
      });
      assert.ok(processed.artifact);
      assert.ok(repeatedProcessed.artifact);
      assert.ok(monthlyProcessed.artifact);
      const artifacts = await service.listGoalReportArtifacts(goal.userId, goal.id);
      const download = await service.downloadGoalReportArtifact(
        goal.userId,
        goal.id,
        processed.artifact.id
      );

      assert.equal(queued.report.type, "WEEKLY_TREND");
      assert.equal(queued.queue.queued, false);
      assert.equal(report.snapshotCount, 3);
      assert.equal(report.averageHealthScore, 80);
      assert.equal(report.previousAverageHealthScore, 55);
      assert.equal(report.scoreDelta, 25);
      assert.equal(report.trendDirection, "up");
      assert.equal(report.riskCounts.danger, 1);
      assert.equal(report.dominantRiskLevel, "danger");
      assert.equal(processed.processed, true);
      assert.ok(processed.report);
      assert.equal(processed.report.averageHealthScore, 80);
      assert.equal(processed.artifact.type, "WEEKLY_TREND");
      assert.equal(processed.artifact.provider, "mock-report");
      assert.equal(repeatedProcessed.artifact.id, processed.artifact.id);
      assert.equal(monthlyReport.snapshotCount, 5);
      assert.equal(monthlyReport.averageHealthScore, 70);
      assert.equal(monthlyReport.trendDirection, "no_data");
      assert.ok(monthlyProcessed.report);
      assert.equal(monthlyProcessed.report.snapshotCount, 5);
      assert.equal(monthlyProcessed.artifact.type, "MONTHLY_TREND");
      assert.equal(artifacts.artifacts.length, 2);
      assert.equal(download.download.contentType, "text/markdown; charset=utf-8");
      assert.match(download.download.content, /执行摘要/);
    } finally {
      await queueService.onModuleDestroy();

      if (previous === undefined) {
        delete process.env.BULLMQ_ENABLED;
      } else {
        process.env.BULLMQ_ENABLED = previous;
      }
    }
  });

  it("falls back to mock report narrative and isolates artifact downloads", async () => {
    const failingProvider = {
      name: "failing-report-provider",
      model: "failure-test",
      generate() {
        throw new Error("simulated report narrative failure");
      }
    };
    const service = new GoalsService(prisma, undefined, failingProvider);
    const owner = await createGoalWithHealthSignals("artifact-owner");
    const foreign = await createGoalWithHealthSignals("artifact-foreign");
    const generated = await service.generateGoalReportArtifact(
      owner.goal.userId,
      owner.goal.id,
      {
        type: "WEEKLY_TREND",
        reportDate: toDateKey(owner.todayStart)
      }
    );
    const stored = await prisma.reportArtifact.findUniqueOrThrow({
      where: { id: generated.artifact.id }
    });

    assert.equal(generated.artifact.provider, "mock-report");
    assert.match(generated.artifact.error ?? "", /simulated report narrative failure/);
    assert.equal(stored.status, "READY");
    assert.match(stored.body, /下一步建议/);
    await assert.rejects(
      () =>
        service.downloadGoalReportArtifact(
          foreign.goal.userId,
          owner.goal.id,
          generated.artifact.id
        ),
      NotFoundException
    );
  });

  it("rejects unsupported report worker jobs", async () => {
    await assert.rejects(
      () =>
        goalsService.processQueuedReportJob({
          type: "MONTHLY_REPORT",
          userId: "user-test",
          goalId: "goal-test"
        }),
      BadRequestException
    );
  });

  it("enforces the free monthly trend report quota", async () => {
    const { goal, todayStart } = await createGoalWithHealthSignals(
      "free-report-limit",
      "FREE"
    );
    await goalsService.generateGoalReportArtifact(goal.userId, goal.id, {
      type: "WEEKLY_TREND",
      reportDate: toDateKey(todayStart)
    });

    await assert.rejects(
      () => goalsService.generateGoalReportArtifact(goal.userId, goal.id, {
        type: "MONTHLY_TREND",
        reportDate: toDateKey(todayStart)
      }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429
    );
  });
});

function buildHealthSnapshot(
  goalId: string,
  date: Date,
  healthScore: number,
  riskLevel: string
) {
  return {
    goalId,
    date,
    healthScore,
    deviationEventId: null,
    completionMetrics: {
      source: "weekly-trend-test"
    },
    rescueMetrics: {
      source: "weekly-trend-test"
    },
    riskLevel
  };
}

async function cleanupTestUsers() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    }
  });
}

async function createGoalWithHealthSignals(
  scenario: string,
  plan: "FREE" | "PRO" = "PRO"
) {
  const todayKey = toDateKey(new Date());
  const todayStart = toBeijingDate(todayKey);
  const yesterdayStart = addDays(todayStart, -1);
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Health ${scenario}`,
      membership: {
        create: { plan, status: "ACTIVE" }
      }
    }
  });
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `健康快照测试 ${scenario}`,
      description: "用于验证救援统计、普通任务完成率和每日健康快照。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: addDays(todayStart, -3),
      endDate: addDays(todayStart, 7),
      dailyTimeBudgetMinutes: 60,
      toleranceDaysAllowed: 2
    }
  });
  const rescueTask = await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: yesterdayStart,
      title: "昨日救援任务",
      description: "完成后验证次日是否恢复普通计划。",
      plannedMinutes: 15,
      taskType: "RESCUE",
      rescueReason: "低投入触发救援。",
      rescueTriggerCode: "LOW_INVESTMENT",
      rescueRiskLevel: "danger",
      status: "DONE"
    }
  });
  await createScoredCheckin({
    userId: user.id,
    goalId: goal.id,
    taskId: rescueTask.id,
    content: "完成救援任务并记录恢复策略。",
    investedMinutes: 15,
    submittedAt: addHours(yesterdayStart, 20),
    score: 82
  });

  const completedNormalTask = await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: todayStart,
      title: "今日普通任务已完成",
      description: "用于验证救援后次日恢复正常计划。",
      plannedMinutes: 60,
      status: "DONE"
    }
  });
  await createScoredCheckin({
    userId: user.id,
    goalId: goal.id,
    taskId: completedNormalTask.id,
    content: "按原计划完成一个普通任务，并补充证据。",
    investedMinutes: 60,
    submittedAt: addHours(todayStart, 9),
    score: 86
  });
  await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: todayStart,
      title: "今日普通任务未完成",
      description: "保留一个未完成普通任务，让完成率为 50%。",
      plannedMinutes: 60,
      status: "PENDING"
    }
  });

  return { user, goal, todayStart };
}

async function createScoredCheckin(input: {
  userId: string;
  goalId: string;
  taskId: string;
  content: string;
  investedMinutes: number;
  submittedAt: Date;
  score: number;
}) {
  const checkin = await prisma.checkin.create({
    data: {
      userId: input.userId,
      goalId: input.goalId,
      dailyTaskId: input.taskId,
      status: "SCORED",
      content: input.content,
      investedMinutes: input.investedMinutes,
      submittedAt: input.submittedAt
    }
  });

  await prisma.aiScore.create({
    data: {
      checkinId: checkin.id,
      totalScore: input.score,
      dimensions: {
        completion: input.score
      },
      evidence: {
        source: "health-snapshot-test"
      },
      summary: "测试评分。",
      suggestion: "继续保持稳定执行。"
    }
  });
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

function addHours(date: Date, hours: number) {
  const next = new Date(date);
  next.setUTCHours(date.getUTCHours() + hours);
  return next;
}

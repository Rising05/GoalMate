import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { GoalsService } from "../goals/goals.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminService } from "./admin.service";

loadEnv();

const TEST_EMAIL_PREFIX = "admin-integration-";
const TEST_CONFIG_KEY = "admin.integration.flag";

const prisma = new PrismaService();
const adminService = new AdminService(prisma);
const goalsService = new GoalsService(prisma);

describe("AdminService integration", () => {
  before(async () => {
    await cleanupTestData();
  });

  after(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("rejects users without an active admin profile", async () => {
    const { user } = await createUser("forbidden");

    await assert.rejects(
      () => adminService.getOverview(user.id),
      ForbiddenException
    );
  });

  it("lists users, goals, AI jobs, and email logs for an admin", async () => {
    const { user: admin } = await createUser("operator");
    const { user: member, goal } = await createUserWithOperationalData("lists");
    const orphanGoalId = `${TEST_EMAIL_PREFIX}orphan-${Date.now()}`;

    await prisma.adminUser.create({
      data: {
        userId: admin.id,
        role: "OPERATOR",
        status: "ACTIVE"
      }
    });
    await createOrphanGoal(orphanGoalId);

    const overview = await adminService.getOverview(admin.id);
    const users = await adminService.listUsers(admin.id);
    const goals = await adminService.listGoals(admin.id);
    const aiJobs = await adminService.listAiJobs(admin.id);
    const emailLogs = await adminService.listEmailLogs(admin.id);

    assert.equal(overview.admin.role, "OPERATOR");
    assert.ok(overview.metrics.users >= 2);
    assert.ok(users.users.some((item) => item.id === member.id));
    assert.ok(goals.goals.some((item) => item.id === goal.id));
    assert.ok(
      goals.goals.some(
        (item) => item.id === orphanGoalId && item.userEmail === "用户已删除"
      )
    );
    assert.ok(aiJobs.jobs.some((item) => item.goalId === goal.id));
    assert.ok(emailLogs.logs.some((item) => item.goalId === goal.id));
  });

  it("filters admin goals, AI jobs, and email logs", async () => {
    const { user: admin } = await createUser("filter-admin");
    const { user: member, goal } =
      await createUserWithOperationalData("filter-operational");

    await prisma.adminUser.create({
      data: {
        userId: admin.id,
        role: "OPERATOR",
        status: "ACTIVE"
      }
    });
    await prisma.aiJob.create({
      data: {
        userId: member.id,
        goalId: goal.id,
        type: "GOAL_PLAN_REPLAN",
        status: "FAILED",
        attempts: 3,
        payload: {
          source: "admin-filter-test"
        },
        error: "provider timeout"
      }
    });
    const cancelledJob = await prisma.aiJob.create({
      data: {
        userId: member.id,
        goalId: goal.id,
        type: "GOAL_PLAN_GENERATION",
        status: "CANCELLED",
        payload: {
          source: "admin-filter-test"
        },
        error: "user cancelled"
      }
    });
    await prisma.emailLog.create({
      data: {
        userId: member.id,
        goalId: goal.id,
        channel: "WECHAT",
        type: "MISSED_CHECKIN",
        recipientEmail: member.email,
        subject: "后台筛选微信提醒",
        content: "用于后台筛选。",
        status: "FAILED",
        attempts: 1,
        error: "wechat not bound"
      }
    });

    const goals = await adminService.listGoals(admin.id, {
      query: "filter-operational",
      status: "AT_RISK",
      category: "STUDY"
    });
    const failedJobs = await adminService.listAiJobs(admin.id, {
      query: "filter-operational",
      status: "FAILED",
      type: "GOAL_PLAN_REPLAN"
    });
    const cancelledJobs = await adminService.listAiJobs(admin.id, {
      status: "CANCELLED"
    });
    const failedWechatLogs = await adminService.listEmailLogs(admin.id, {
      query: "后台筛选",
      status: "FAILED",
      channel: "WECHAT",
      type: "MISSED_CHECKIN"
    });

    assert.equal(goals.total, 1);
    assert.equal(goals.goals[0].id, goal.id);
    assert.equal(goals.filters.status, "AT_RISK");
    assert.equal(goals.filters.category, "STUDY");
    assert.equal(failedJobs.total, 1);
    assert.equal(failedJobs.jobs[0].type, "GOAL_PLAN_REPLAN");
    assert.equal(failedJobs.jobs[0].status, "FAILED");
    assert.ok(cancelledJobs.jobs.some((job) => job.id === cancelledJob.id));
    assert.equal(failedWechatLogs.total, 1);
    assert.equal(failedWechatLogs.logs[0].channel, "WECHAT");
    assert.equal(failedWechatLogs.logs[0].status, "FAILED");
    await assert.rejects(
      () => adminService.listGoals(admin.id, { category: "UNKNOWN" }),
      BadRequestException
    );
    await assert.rejects(
      () => adminService.listAiJobs(admin.id, { status: "ABORTED" }),
      BadRequestException
    );
    await assert.rejects(
      () => adminService.listEmailLogs(admin.id, { channel: "SMS" }),
      BadRequestException
    );
  });

  it("searches admin users by query, status, membership plan, and admin role", async () => {
    const { user: admin } = await createUser("search-admin");
    const { user: alpha } = await createUser("search-alpha");
    const { user: beta } = await createUser("search-beta");

    await prisma.adminUser.createMany({
      data: [
        {
          userId: admin.id,
          role: "OPERATOR",
          status: "ACTIVE"
        },
        {
          userId: alpha.id,
          role: "SUPER_ADMIN",
          status: "ACTIVE"
        }
      ]
    });
    await prisma.user.update({
      where: { id: alpha.id },
      data: {
        displayName: "Search Alpha",
        membership: {
          create: {
            plan: "PRO",
            status: "MANUAL"
          }
        }
      }
    });
    await prisma.user.update({
      where: { id: beta.id },
      data: {
        displayName: "Search Beta",
        status: "DISABLED",
        membership: {
          create: {
            plan: "FREE",
            status: "ACTIVE"
          }
        }
      }
    });

    const byQuery = await adminService.listUsers(admin.id, {
      query: "alpha",
      plan: "PRO"
    });
    const byStatus = await adminService.listUsers(admin.id, {
      status: "DISABLED"
    });
    const byRole = await adminService.listUsers(admin.id, {
      adminRole: "SUPER_ADMIN"
    });

    assert.equal(byQuery.total, 1);
    assert.equal(byQuery.users[0].id, alpha.id);
    assert.equal(byQuery.users[0].membership?.plan, "PRO");
    assert.equal(byQuery.filters.query, "alpha");
    assert.equal(byQuery.filters.plan, "PRO");
    assert.ok(byStatus.users.some((user) => user.id === beta.id));
    assert.ok(byStatus.users.every((user) => user.status === "DISABLED"));
    assert.ok(byRole.users.some((user) => user.id === alpha.id));
    assert.ok(byRole.users.every((user) => user.adminRole === "SUPER_ADMIN"));
    await assert.rejects(
      () => adminService.listUsers(admin.id, { plan: "ENTERPRISE" }),
      BadRequestException
    );
  });

  it("manually opens a membership and writes an audit log", async () => {
    const { user: admin } = await createUser("membership-admin");
    const { user: member } = await createUser("membership-member");

    await prisma.adminUser.create({
      data: {
        userId: admin.id,
        role: "OPERATOR",
        status: "ACTIVE"
      }
    });

    const result = await adminService.updateMembership(admin.id, member.id, {
      plan: "PRO",
      status: "MANUAL",
      reason: "用户线下付费后手动开通"
    });
    const auditLogs = await adminService.listAuditLogs(admin.id);

    assert.equal(result.membership.userId, member.id);
    assert.equal(result.membership.plan, "PRO");
    assert.equal(result.membership.status, "MANUAL");
    assert.ok(
      auditLogs.logs.some(
        (log) =>
          log.action === "MEMBERSHIP_UPDATE" &&
          log.targetId === member.id &&
          log.reason === "用户线下付费后手动开通"
      )
    );
  });

  it("requires super-admin access and a reason before returning raw content", async () => {
    const { user: operator } = await createUser("raw-operator");
    const { user: superAdmin } = await createUser("raw-super");
    const { user: member, goal } = await createUserWithOperationalData("raw-member");

    await prisma.adminUser.createMany({
      data: [
        {
          userId: operator.id,
          role: "OPERATOR",
          status: "ACTIVE"
        },
        {
          userId: superAdmin.id,
          role: "SUPER_ADMIN",
          status: "ACTIVE"
        }
      ]
    });

    await assert.rejects(
      () =>
        adminService.getRawUserContent(
          operator.id,
          member.id,
          "排查用户反馈中的 AI 评分争议"
        ),
      ForbiddenException
    );
    await assert.rejects(
      () => adminService.getRawUserContent(superAdmin.id, member.id, "太短"),
      BadRequestException
    );

    const rawContent = await adminService.getRawUserContent(
      superAdmin.id,
      member.id,
      "排查用户反馈中的 AI 评分争议"
    );
    const auditLogs = await adminService.listAuditLogs(superAdmin.id);

    assert.equal(rawContent.user.id, member.id);
    assert.ok(rawContent.goals.some((item) => item.id === goal.id));
    assert.ok(
      auditLogs.logs.some(
        (log) =>
          log.action === "RAW_USER_CONTENT_VIEW" &&
          log.targetId === member.id &&
          log.reason === "排查用户反馈中的 AI 评分争议"
      )
    );
  });

  it("lets a super-admin upsert system config with audit logging", async () => {
    const { user: superAdmin } = await createUser("config-super");

    await prisma.adminUser.create({
      data: {
        userId: superAdmin.id,
        role: "SUPER_ADMIN",
        status: "ACTIVE"
      }
    });

    const result = await adminService.upsertSystemConfig(superAdmin.id, {
      key: TEST_CONFIG_KEY,
      value: {
        enabled: true,
        threshold: 3
      },
      description: "后台集成测试配置",
      reason: "验证系统配置管理"
    });
    const configs = await adminService.listSystemConfigs(superAdmin.id);
    const auditLogs = await adminService.listAuditLogs(superAdmin.id);

    assert.equal(result.config.key, TEST_CONFIG_KEY);
    assert.deepEqual(result.config.value, {
      enabled: true,
      threshold: 3
    });
    assert.ok(configs.configs.some((config) => config.key === TEST_CONFIG_KEY));
    assert.ok(
      auditLogs.logs.some(
        (log) =>
          log.action === "SYSTEM_CONFIG_UPSERT" &&
          log.targetId === TEST_CONFIG_KEY
      )
    );
  });

  it("lets an admin retry a failed failure-report job with audit logging", async () => {
    const { user: admin } = await createUser("retry-admin");
    const { user: member, goal } = await createUserWithOperationalData("retry-job");

    await prisma.adminUser.create({
      data: {
        userId: admin.id,
        role: "OPERATOR",
        status: "ACTIVE"
      }
    });
    await prisma.goal.update({
      where: { id: goal.id },
      data: { status: "FAILED" }
    });

    const failedJob = await prisma.aiJob.create({
      data: {
        userId: member.id,
        goalId: goal.id,
        type: "FAILURE_REPORT_GENERATION",
        status: "FAILED",
        attempts: 3,
        payload: {
          goalId: goal.id,
          provider: "rule-failure-report",
          promptVersion: "failure-report-v1"
        },
        error: "Failure report provider timeout"
      }
    });

    await assert.rejects(
      () => adminService.retryAiJob(admin.id, failedJob.id, { reason: "太短" }),
      BadRequestException
    );

    const result = await adminService.retryAiJob(admin.id, failedJob.id, {
      reason: "后台排查失败后手动重试"
    });
    const storedJob = await prisma.aiJob.findUniqueOrThrow({
      where: { id: failedJob.id }
    });
    const auditLogs = await adminService.listAuditLogs(admin.id);
    const payload = storedJob.payload as {
      adminRetry?: {
        reason?: string;
        previousStatus?: string;
        previousAttempts?: number;
        previousError?: string;
        queue?: { queued?: boolean; queueName?: string; reason?: string };
      };
    };

    assert.equal(result.job.id, failedJob.id);
    assert.equal(result.job.status, "QUEUED");
    assert.equal(result.job.attempts, 0);
    assert.equal(result.job.error, null);
    assert.equal(storedJob.status, "QUEUED");
    assert.equal(storedJob.attempts, 0);
    assert.equal(storedJob.error, null);
    assert.equal(payload.adminRetry?.reason, "后台排查失败后手动重试");
    assert.equal(payload.adminRetry?.previousStatus, "FAILED");
    assert.equal(payload.adminRetry?.previousAttempts, 3);
    assert.equal(payload.adminRetry?.previousError, "Failure report provider timeout");
    assert.equal(payload.adminRetry?.queue?.queued, false);
    assert.equal(payload.adminRetry?.queue?.queueName, "ai-jobs");
    assert.ok(
      auditLogs.logs.some(
        (log) =>
          log.action === "AI_JOB_RETRY" &&
          log.targetId === failedJob.id &&
          log.reason === "后台排查失败后手动重试"
      )
    );
    const processed = await goalsService.processQueuedFailureReportJob(failedJob.id);

    assert.equal(processed.job.status, "SUCCEEDED");
    assert.equal(processed.failureReport?.goalId, goal.id);
    assert.ok(await prisma.failureReport.findUnique({ where: { goalId: goal.id } }));
    await assert.rejects(
      () =>
        adminService.retryAiJob(admin.id, failedJob.id, {
          reason: "重复重试应被拒绝"
        }),
      BadRequestException
    );
  });
});

async function cleanupTestData() {
  await prisma.goal.deleteMany({
    where: {
      id: {
        startsWith: `${TEST_EMAIL_PREFIX}orphan-`
      }
    }
  });
  await prisma.systemConfig.deleteMany({
    where: {
      key: TEST_CONFIG_KEY
    }
  });
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
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Admin ${scenario}`
    }
  });

  return { user };
}

async function createOrphanGoal(id: string) {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO goals (
        id,
        userId,
        title,
        description,
        category,
        status,
        startDate,
        endDate,
        timezone,
        toleranceDaysAllowed,
        toleranceDaysUsed,
        dailyTimeBudgetMinutes,
        createdAt,
        updatedAt
      ) VALUES (?, ?, ?, ?, 'STUDY', 'DRAFT', ?, ?, 'Asia/Shanghai', 0, 0, 20, NOW(), NOW())`,
      id,
      `${id}-missing-user`,
      "孤儿后台目标",
      "用于验证后台目标列表兜底。",
      new Date("2026-06-10T00:00:00.000+08:00"),
      new Date("2026-06-20T00:00:00.000+08:00")
    );
  } finally {
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
  }
}

async function createUserWithOperationalData(scenario: string) {
  const { user } = await createUser(scenario);
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `后台目标 ${scenario}`,
      description: "用于验证后台目标列表和敏感原文查看。",
      category: "STUDY",
      status: "AT_RISK",
      startDate: new Date("2026-06-01T00:00:00.000+08:00"),
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2,
      dailyTimeBudgetMinutes: 30,
      currentBaseline: "当前基础原文",
      constraints: "限制条件原文",
      finalReward: "最终奖励原文"
    }
  });
  const task = await prisma.dailyTask.create({
    data: {
      goalId: goal.id,
      taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
      title: "后台任务",
      description: "用于后台统计。",
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
      content: "用户完成记录原文。",
      investedMinutes: 28,
      submittedAt: new Date("2026-06-10T20:00:00.000+08:00")
    }
  });

  await prisma.aiScore.create({
    data: {
      checkinId: checkin.id,
      totalScore: 88,
      dimensions: {
        completion: 88
      },
      evidence: {
        source: "admin-test"
      },
      summary: "完成质量稳定。",
      suggestion: "继续保持。"
    }
  });
  await prisma.deviationEvent.create({
    data: {
      goalId: goal.id,
      sourceDailyTaskId: task.id,
      riskLevel: "warning",
      primaryReasonCode: "LOW_INVESTMENT",
      primaryReasonLabel: "投入不足",
      primaryReasonDetail: "近几天投入低于计划。",
      reasons: [
        {
          code: "LOW_INVESTMENT",
          level: "warning",
          label: "投入不足",
          detail: "近几天投入低于计划。"
        }
      ],
      metrics: {
        recentInvestedMinutes: 30,
        expectedRecentMinutes: 90
      }
    }
  });
  await prisma.rewardCard.create({
    data: {
      goalId: goal.id,
      title: "后台奖励",
      description: "奖励卡片原文",
      cardType: "TEXT",
      sourceType: "CUSTOM"
    }
  });
  await prisma.aiJob.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      type: "SCORE_CHECKIN",
      status: "SUCCEEDED",
      attempts: 1,
      payload: {
        checkinId: checkin.id
      },
      result: {
        score: 88
      }
    }
  });
  await prisma.emailLog.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      type: "DAILY_TASK",
      recipientEmail: user.email,
      subject: "后台邮件日志",
      content: "提醒内容",
      status: "QUEUED",
      scheduledFor: new Date("2026-06-11T09:00:00.000+08:00")
    }
  });

  return { user, goal };
}

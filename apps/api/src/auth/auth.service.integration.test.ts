import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SessionTokenService } from "./session-token.service";

loadEnv();

const TEST_EMAIL_PREFIX = "auth-quota-integration-";

const prisma = new PrismaService();
const authService = new AuthService(
  prisma,
  new PasswordService(),
  new SessionTokenService()
);

describe("AuthService quota integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("returns membership quota and AI usage statistics for the current user", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const registered = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: "password-123",
      displayName: "Quota User"
    });

    assert.equal(registered.user.quota.plan, "FREE");
    assert.equal(registered.user.quota.activeGoals.limit, 1);
    assert.equal(registered.user.quota.aiJobsToday.limit, 20);
    assert.equal(registered.user.adminRole, null);

    await prisma.goal.create({
      data: {
        userId: registered.user.id,
        title: "额度统计目标",
        description: "用于验证当前用户额度统计。",
        category: "STUDY",
        status: "ACTIVE",
        startDate: new Date("2026-06-10T00:00:00.000+08:00"),
        endDate: new Date("2026-06-20T00:00:00.000+08:00"),
        toleranceDaysAllowed: 1
      }
    });
    await prisma.aiJob.create({
      data: {
        userId: registered.user.id,
        type: "GOAL_PLAN_REPLAN",
        status: "SUCCEEDED",
        attempts: 1,
        payload: {
          source: "auth-quota-test"
        }
      }
    });

    const current = await authService.getCurrentUser(
      `Bearer ${registered.token}`
    );

    assert.equal(current.user.quota.activeGoals.used, 1);
    assert.equal(current.user.quota.aiJobsToday.used, 1);
    assert.equal(current.user.quota.replansThisWeek.used, 1);
    assert.equal(current.user.quota.scoreAppealsThisWeek.used, 0);
    assert.equal(current.user.adminRole, null);
  });

  it("returns an active admin role so the web app can show the admin entry", async () => {
    const suffix = `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const registered = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: "password-123",
      displayName: "Admin User"
    });

    await prisma.adminUser.create({
      data: {
        userId: registered.user.id,
        role: "SUPER_ADMIN",
        status: "ACTIVE"
      }
    });

    const current = await authService.getCurrentUser(
      `Bearer ${registered.token}`
    );

    assert.equal(current.user.adminRole, "SUPER_ADMIN");
  });

  it("exports selected current-user data without leaking other users or password hashes", async () => {
    const suffix = `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const registered = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: "password-123",
      displayName: "Export User"
    });
    const other = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}-other@example.com`,
      password: "password-123",
      displayName: "Other Export User"
    });
    const goal = await prisma.goal.create({
      data: {
        userId: registered.user.id,
        title: "导出目标",
        description: "用于验证数据导出。",
        category: "POSTGRAD_EXAM",
        status: "ACTIVE",
        startDate: new Date("2026-06-10T00:00:00.000+08:00"),
        endDate: new Date("2026-07-10T00:00:00.000+08:00"),
        toleranceDaysAllowed: 2,
        subjects: ["数学", "英语"],
        materials: ["真题"],
        chapters: ["高数第一章"]
      }
    });
    const plan = await prisma.plan.create({
      data: {
        goalId: goal.id,
        summary: "导出计划",
        isActive: true,
        confirmedAt: new Date("2026-06-10T02:00:00.000Z")
      }
    });
    const weeklyPlan = await prisma.weeklyPlan.create({
      data: {
        planId: plan.id,
        weekIndex: 1,
        title: "第一周",
        summary: "基础复习",
        startsOn: new Date("2026-06-10T00:00:00.000+08:00"),
        endsOn: new Date("2026-06-16T00:00:00.000+08:00")
      }
    });
    const task = await prisma.dailyTask.create({
      data: {
        goalId: goal.id,
        weeklyPlanId: weeklyPlan.id,
        taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
        title: "导出任务",
        description: "完成题目并上传证据。",
        plannedMinutes: 60,
        studyTaskType: "PRACTICE",
        subject: "数学",
        questionCount: 30,
        targetAccuracy: 80,
        evidenceRequired: true
      }
    });
    const checkin = await prisma.checkin.create({
      data: {
        userId: registered.user.id,
        goalId: goal.id,
        dailyTaskId: task.id,
        content: "完成 30 题，错题已整理。",
        investedMinutes: 70,
        completedSubtasks: ["刷题", "整理错题"],
        actualQuestionCount: 30,
        correctQuestionCount: 24,
        accuracy: 80,
        evidenceFiles: ["mock://image-1.png"],
        evidenceLinks: ["https://example.com/wrong-note"],
        studyMood: "FOCUSED",
        difficultyLevel: "MEDIUM"
      }
    });
    await prisma.aiScore.create({
      data: {
        checkinId: checkin.id,
        totalScore: 86,
        dimensions: { completion: 90 },
        evidence: { actualQuestionCount: 30 },
        summary: "完成度较高。",
        suggestion: "继续复盘错题。"
      }
    });
    await prisma.emailLog.create({
      data: {
        userId: registered.user.id,
        goalId: goal.id,
        channel: "EMAIL",
        type: "DAILY_TASK",
        recipientEmail: registered.user.email,
        subject: "导出提醒",
        content: "继续保持。",
        status: "SENT",
        attempts: 1,
        sentAt: new Date("2026-06-10T03:00:00.000Z")
      }
    });
    await prisma.wechatBinding.create({
      data: {
        userId: registered.user.id,
        openId: `openid-${suffix}`,
        nickname: "导出用户"
      }
    });
    await prisma.goal.create({
      data: {
        userId: other.user.id,
        title: "其他用户目标",
        description: "不应出现在导出结果中。",
        category: "STUDY",
        status: "ACTIVE",
        startDate: new Date("2026-06-10T00:00:00.000+08:00"),
        endDate: new Date("2026-06-20T00:00:00.000+08:00")
      }
    });

    const exported = await authService.exportCurrentUserData(
      `Bearer ${registered.token}`,
      {
        format: "JSON",
        fullExport: false,
        scopes: [
          "profile",
          "goals",
          "plans",
          "dailyTasks",
          "checkins",
          "aiScores",
          "emailLogs",
          "wechatBinding"
        ]
      }
    );
    const data = exported.data as Record<string, unknown>;
    const profile = data.profile as Record<string, unknown>;
    const goals = data.goals as Array<Record<string, unknown>>;
    const checkins = data.checkins as Array<Record<string, unknown>>;
    const scores = data.aiScores as Array<Record<string, unknown>>;
    const logs = data.emailLogs as Array<Record<string, unknown>>;

    assert.equal(exported.status, "READY");
    assert.equal(exported.fullExport, false);
    assert.deepEqual(exported.scopes, [
      "profile",
      "goals",
      "plans",
      "dailyTasks",
      "checkins",
      "aiScores",
      "emailLogs",
      "wechatBinding"
    ]);
    assert.equal(profile.email, registered.user.email);
    assert.equal("passwordHash" in profile, false);
    assert.equal(goals.length, 1);
    assert.equal(goals[0].title, "导出目标");
    assert.equal(checkins[0].actualQuestionCount, 30);
    assert.deepEqual(checkins[0].evidenceLinks, [
      "https://example.com/wrong-note"
    ]);
    assert.equal(scores[0].totalScore, 86);
    assert.equal(logs[0].channel, "EMAIL");
    assert.equal("membership" in data, false);
    assert.match(JSON.stringify(exported), /导出目标/);
    assert.doesNotMatch(JSON.stringify(exported), /其他用户目标/);
    assert.doesNotMatch(JSON.stringify(exported), /passwordHash/);
  });

  it("exports selected current-user data as a CSV download", async () => {
    const suffix = `export-csv-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const registered = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: "password-123",
      displayName: "CSV Export User"
    });

    await prisma.goal.create({
      data: {
        userId: registered.user.id,
        title: "CSV 导出目标",
        description: "用于验证 CSV 文件导出。",
        category: "STUDY",
        status: "ACTIVE",
        startDate: new Date("2026-06-10T00:00:00.000+08:00"),
        endDate: new Date("2026-06-20T00:00:00.000+08:00")
      }
    });

    const exported = await authService.exportCurrentUserData(
      `Bearer ${registered.token}`,
      {
        format: "CSV",
        fullExport: false,
        scopes: ["profile", "goals"]
      }
    );

    assert.equal(exported.status, "READY");
    assert.equal(exported.format, "CSV");
    assert.equal(exported.data, null);
    assert.equal(exported.download?.contentType, "text/csv; charset=utf-8");
    assert.match(exported.download?.filename ?? "", /\.csv$/);
    assert.match(exported.download?.content ?? "", /^scope,recordIndex,field,value/);
    assert.match(exported.download?.content ?? "", /CSV Export User/);
    assert.match(exported.download?.content ?? "", /CSV 导出目标/);
    assert.doesNotMatch(exported.download?.content ?? "", /passwordHash/);
  });

  it("exports selected current-user data as a PDF report download", async () => {
    const suffix = `export-pdf-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const registered = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: "password-123",
      displayName: "PDF Export User"
    });

    await prisma.goal.create({
      data: {
        userId: registered.user.id,
        title: "PDF 导出目标",
        description: "用于验证 PDF 文件导出。",
        category: "STUDY",
        status: "ACTIVE",
        startDate: new Date("2026-06-10T00:00:00.000+08:00"),
        endDate: new Date("2026-06-20T00:00:00.000+08:00")
      }
    });

    const exported = await authService.exportCurrentUserData(
      `Bearer ${registered.token}`,
      {
        format: "PDF",
        fullExport: false,
        scopes: ["profile", "goals"]
      }
    );
    const pdfContent = Buffer.from(exported.download?.content ?? "", "base64").toString(
      "utf8"
    );

    assert.equal(exported.status, "READY");
    assert.equal(exported.format, "PDF");
    assert.equal(exported.data, null);
    assert.equal(exported.download?.contentType, "application/pdf");
    assert.equal(exported.download?.encoding, "base64");
    assert.match(exported.download?.filename ?? "", /\.pdf$/);
    assert.match(pdfContent, /^%PDF-1\.4/);
    assert.match(pdfContent, /GoalMate Account Export/);
    assert.match(pdfContent, /PDF Export User/);
    assert.doesNotMatch(pdfContent, /passwordHash/);
  });

  it("exports selected current-user data as an Excel workbook download", async () => {
    const suffix = `export-excel-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const registered = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: "password-123",
      displayName: "Excel Export User"
    });

    await prisma.goal.create({
      data: {
        userId: registered.user.id,
        title: "Excel 导出目标",
        description: "用于验证 Excel 文件导出。",
        category: "STUDY",
        status: "ACTIVE",
        startDate: new Date("2026-06-10T00:00:00.000+08:00"),
        endDate: new Date("2026-06-20T00:00:00.000+08:00")
      }
    });

    const exported = await authService.exportCurrentUserData(
      `Bearer ${registered.token}`,
      {
        format: "EXCEL",
        fullExport: false,
        scopes: ["profile", "goals"]
      }
    );

    assert.equal(exported.status, "READY");
    assert.equal(exported.format, "EXCEL");
    assert.equal(exported.data, null);
    assert.equal(
      exported.download?.contentType,
      "application/vnd.ms-excel; charset=utf-8"
    );
    assert.equal(exported.download?.encoding, "utf-8");
    assert.match(exported.download?.filename ?? "", /\.xls$/);
    assert.match(exported.download?.content ?? "", /^<\?xml version="1\.0"/);
    assert.match(exported.download?.content ?? "", /GoalMate Export/);
    assert.match(exported.download?.content ?? "", /Excel Export User/);
    assert.match(exported.download?.content ?? "", /Excel 导出目标/);
    assert.doesNotMatch(exported.download?.content ?? "", /passwordHash/);
  });

  it("deletes the current account and cascades owned data", async () => {
    const suffix = `delete-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const registered = await authService.register({
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      password: "password-123",
      displayName: "Delete User"
    });
    const goal = await prisma.goal.create({
      data: {
        userId: registered.user.id,
        title: "账号删除目标",
        description: "用于验证账号删除级联。",
        category: "STUDY",
        status: "ACTIVE",
        startDate: new Date("2026-06-10T00:00:00.000+08:00"),
        endDate: new Date("2026-06-20T00:00:00.000+08:00"),
        toleranceDaysAllowed: 1
      }
    });
    await prisma.dailyTask.create({
      data: {
        goalId: goal.id,
        taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
        title: "账号删除任务",
        description: "用于验证账号删除。",
        plannedMinutes: 20
      }
    });

    const result = await authService.deleteCurrentUser(
      `Bearer ${registered.token}`
    );
    const [storedUser, goalCount, taskCount, membershipCount] = await Promise.all([
      prisma.user.findUnique({ where: { id: registered.user.id } }),
      prisma.goal.count({ where: { userId: registered.user.id } }),
      prisma.dailyTask.count({ where: { goalId: goal.id } }),
      prisma.membership.count({ where: { userId: registered.user.id } })
    ]);

    assert.equal(result.deletedUserId, registered.user.id);
    assert.equal(storedUser, null);
    assert.equal(goalCount, 0);
    assert.equal(taskCount, 0);
    assert.equal(membershipCount, 0);
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

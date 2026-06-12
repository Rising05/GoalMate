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

import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { MailProvider } from "./mail-provider";
import { NotificationsService } from "./notifications.service";

loadEnv();

const TEST_EMAIL_PREFIX = "notifications-integration-";

const prisma = new PrismaService();
const notificationsService = new NotificationsService(prisma);

describe("NotificationsService integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("creates a default notification preference for a user", async () => {
    const user = await createUser("default");

    const preference = await notificationsService.getPreference(user.id);

    assert.equal(preference.enabled, true);
    assert.equal(preference.reminderTime, "09:00");
    assert.equal(preference.timezone, "Asia/Shanghai");
    assert.ok(preference.reminderTypes.includes("DAILY_TASK"));
    assert.ok(preference.availableTypes.length >= 6);
  });

  it("updates notification preference and validates reminder time", async () => {
    const user = await createUser("update");

    const preference = await notificationsService.updatePreference(user.id, {
      enabled: false,
      reminderTime: "21:30",
      reminderTypes: ["DAILY_TASK", "FAILURE_REVIEW"],
      timezone: "Asia/Shanghai"
    });

    assert.equal(preference.enabled, false);
    assert.equal(preference.reminderTime, "21:30");
    assert.deepEqual(preference.reminderTypes, ["DAILY_TASK", "FAILURE_REVIEW"]);
    await assert.rejects(
      () =>
        notificationsService.updatePreference(user.id, {
          enabled: true,
          reminderTime: "25:99",
          reminderTypes: ["DAILY_TASK"]
        }),
      BadRequestException
    );
  });

  it("creates preview email logs and lists them", async () => {
    const user = await createUser("logs");
    await notificationsService.updatePreference(user.id, {
      enabled: true,
      reminderTime: "08:15",
      reminderTypes: ["MILESTONE"]
    });

    const preview = await notificationsService.createPreviewEmailLog(user.id, {
      type: "MILESTONE"
    });
    const logs = await notificationsService.listEmailLogs(user.id);

    assert.equal(preview.log.type, "MILESTONE");
    assert.equal(preview.log.status, "QUEUED");
    assert.equal(preview.log.recipientEmail, user.email);
    assert.ok(preview.log.scheduledFor);
    assert.equal(logs.logs.length, 1);
    assert.equal(logs.logs[0].id, preview.log.id);
  });

  it("queues due reminder emails once per day and processes them as sent", async () => {
    const user = await createUser("queue");
    await createGoalForReminders(user.id);
    await notificationsService.updatePreference(user.id, {
      enabled: true,
      reminderTime: "09:00",
      reminderTypes: ["DAILY_TASK", "MISSED_CHECKIN", "TOLERANCE_RISK", "MILESTONE"]
    });

    const first = await notificationsService.enqueueDueEmailLogs(user.id, {
      now: "2026-06-10T10:00:00.000+08:00"
    });
    const second = await notificationsService.enqueueDueEmailLogs(user.id, {
      now: "2026-06-10T10:30:00.000+08:00"
    });
    const processed = await notificationsService.processQueuedEmailLogs(user.id, {
      now: "2026-06-10T10:31:00.000+08:00"
    });

    assert.equal(first.queued.length, 4);
    assert.equal(second.queued.length, 0);
    assert.ok(second.skipped.length >= 4);
    assert.equal(processed.sent, 4);
    assert.equal(processed.failed, 0);
    assert.ok(processed.processed.every((log) => log.status === "SENT"));
    assert.ok(processed.processed.every((log) => log.sentAt));
  });

  it("records failed email delivery attempts", async () => {
    const user = await createUser("failure");
    await notificationsService.createPreviewEmailLog(user.id, {
      type: "DAILY_TASK",
      scheduledFor: "2026-06-11T09:00:00.000+08:00"
    });

    const processed = await notificationsService.processQueuedEmailLogs(user.id, {
      now: "2026-06-11T10:00:00.000+08:00",
      simulateFailure: true
    });
    const logs = await notificationsService.listEmailLogs(user.id);

    assert.equal(processed.sent, 0);
    assert.equal(processed.failed, 1);
    assert.equal(logs.logs[0].status, "FAILED");
    assert.equal(logs.logs[0].error, "Mock email provider failed");
  });

  it("sends queued logs through the configured mail provider", async () => {
    const provider = new CountingMailProvider();
    const service = new NotificationsService(prisma, provider);
    const user = await createUser("provider");
    await service.createPreviewEmailLog(user.id, {
      type: "DAILY_TASK",
      scheduledFor: "2026-06-11T09:00:00.000+08:00"
    });

    const processed = await service.processQueuedEmailLogs(user.id, {
      now: "2026-06-11T10:00:00.000+08:00"
    });

    assert.equal(provider.calls, 1);
    assert.equal(processed.sent, 1);
    assert.equal(processed.processed[0].status, "SENT");
  });
});

class CountingMailProvider implements MailProvider {
  readonly name = "counting-mail";
  calls = 0;

  async send() {
    this.calls += 1;
    return {
      status: "SENT" as const,
      error: null
    };
  }
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

async function createUser(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Notifications ${scenario}`
    }
  });
}

async function createGoalForReminders(userId: string) {
  return prisma.goal.create({
    data: {
      userId,
      title: "邮件提醒目标",
      description: "用于验证邮件提醒任务。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date("2026-06-01T00:00:00.000+08:00"),
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2,
      toleranceDaysUsed: 1,
      dailyTasks: {
        create: {
          taskDate: new Date("2026-06-10T00:00:00.000+08:00"),
          title: "今日提醒任务",
          description: "保持未完成以触发提醒。",
          plannedMinutes: 30,
          status: "PENDING"
        }
      },
      milestones: {
        create: {
          title: "今日里程碑",
          description: "用于触发阶段里程碑提醒。",
          targetDate: new Date("2026-06-10T00:00:00.000+08:00")
        }
      }
    }
  });
}

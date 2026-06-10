import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
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

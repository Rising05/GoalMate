import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { QuotaService } from "./quota.service";

loadEnv();

const TEST_EMAIL_PREFIX = "quota-enforcement-integration-";
const prisma = new PrismaService();
const quota = new QuotaService(prisma);

describe("QuotaService integration", () => {
  before(async () => cleanup());
  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("enforces a free daily limit atomically under concurrent requests", async () => {
    const user = await createUser("concurrent", "FREE");
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        quota.runWithQuota(
          user.id,
          "CHECKIN_SCORING",
          {
            idempotencyKey: `quota-concurrent-${user.id}-${index}`,
            resourceType: "CHECKIN",
            resourceId: `checkin-${index}`
          },
          async () => index
        )
      )
    );

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    assert.equal(rejected.length, 2);
    assert.ok(rejected.every((result) => result.reason instanceof HttpException));
    assert.equal(
      await prisma.usageRecord.count({
        where: { userId: user.id, capability: "CHECKIN_SCORING" }
      }),
      3
    );
    const summary = await quota.getSummary(user.id);
    assert.equal(summary.CHECKIN_SCORING.used, 3);
    assert.equal(summary.CHECKIN_SCORING.limit, 3);
  });

  it("does not charge an idempotent operation twice", async () => {
    const user = await createUser("idempotent", "FREE");
    const input = {
      idempotencyKey: `quota-idempotent-${user.id}`,
      resourceType: "AI_JOB",
      resourceId: "same-job"
    };

    await quota.runWithQuota(user.id, "GOAL_REPLAN", input, async () => true);
    await quota.runWithQuota(user.id, "GOAL_REPLAN", input, async () => true);

    const summary = await quota.getSummary(user.id);
    assert.equal(summary.GOAL_REPLAN.used, 1);
    assert.equal(
      await prisma.usageRecord.count({ where: { idempotencyKey: input.idempotencyKey } }),
      1
    );
  });

  it("applies Pro, expired membership, and entitlement overrides", async () => {
    const pro = await createUser("pro", "PRO");
    const expired = await createUser("expired", "PRO", new Date("2020-01-01T00:00:00Z"));
    const overridden = await createUser("entitlement", "FREE");
    await prisma.entitlement.create({
      data: {
        userId: overridden.id,
        capability: "SCORE_APPEAL",
        limitValue: 4,
        source: "TEST"
      }
    });

    assert.equal((await quota.getSummary(pro.id)).SCORE_APPEAL.limit, 10);
    assert.equal((await quota.getSummary(expired.id)).SCORE_APPEAL.limit, 1);
    assert.equal((await quota.getSummary(overridden.id)).SCORE_APPEAL.limit, 4);
  });

  it("releases total capacity when a resource is deleted", async () => {
    const user = await createUser("release", "FREE");
    await quota.runWithQuota(
      user.id,
      "REWARD_CARD",
      {
        idempotencyKey: `reward-release-${user.id}`,
        resourceType: "REWARD_CARD",
        resourceId: "reward-1"
      },
      async () => true
    );
    await prisma.$transaction((tx) =>
      quota.releaseWithClient(tx, user.id, "REWARD_CARD", "REWARD_CARD", "reward-1")
    );

    const summary = await quota.getSummary(user.id);
    assert.equal(summary.REWARD_CARD.used, 0);
    const record = await prisma.usageRecord.findFirstOrThrow({
      where: { userId: user.id, capability: "REWARD_CARD" }
    });
    assert.ok(record.releasedAt);
  });
});

async function createUser(scenario: string, plan: "FREE" | "PRO", expiresAt?: Date) {
  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${scenario}-${Date.now()}-${Math.random()}@example.com`,
      passwordHash: "test-password-hash",
      membership: {
        create: {
          plan,
          status: "ACTIVE",
          expiresAt
        }
      }
    }
  });
}

async function cleanup() {
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } }
  });
}

import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { RewardsService } from "./rewards.service";

loadEnv();

const TEST_EMAIL_PREFIX = "reward-board-integration-";

const prisma = new PrismaService();
const rewardsService = new RewardsService(prisma);

describe("RewardsService integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("syncs final and milestone rewards into the reward board", async () => {
    const { goal } = await createGoalWithRewards("anchors");

    const board = await rewardsService.getRewardBoard(goal.userId, goal.id);
    const finalReward = board.cards.find(
      (card) => card.sourceType === "FINAL_REWARD"
    );
    const milestoneRewards = board.cards.filter(
      (card) => card.sourceType === "MILESTONE_REWARD"
    );

    assert.equal(board.goalId, goal.id);
    assert.equal(finalReward?.title, "最终奖励");
    assert.equal(finalReward?.description, "兑现最终奖励");
    assert.equal(milestoneRewards.length, 2);
    assert.deepEqual(
      milestoneRewards.map((card) => card.description),
      ["阶段奖励 1", "阶段奖励 2"]
    );
  });

  it("creates, reorders, and deletes custom reward cards", async () => {
    const { goal } = await createGoalWithRewards("custom");

    const created = await rewardsService.createRewardCard(goal.userId, goal.id, {
      title: "自定义图片奖励",
      description: "完成本周后查看这张图片",
      cardType: "IMAGE",
      imageUrl: "data:image/png;base64,iVBORw0KGgo=",
      sortOrder: 9
    });
    const updated = await rewardsService.updateRewardCard(
      goal.userId,
      goal.id,
      created.card.id,
      {
        title: "自定义图片奖励已更新",
        cardType: "LINK",
        linkUrl: "https://example.com/reward",
        sortOrder: 1
      }
    );
    const deleted = await rewardsService.deleteRewardCard(
      goal.userId,
      goal.id,
      created.card.id
    );

    assert.equal(created.card.sourceType, "CUSTOM");
    assert.equal(updated.card.title, "自定义图片奖励已更新");
    assert.equal(updated.card.cardType, "LINK");
    assert.equal(updated.card.linkUrl, "https://example.com/reward");
    assert.equal(updated.card.sortOrder, 1);
    assert.equal(deleted.deletedId, created.card.id);
  });

  it("protects anchor cards and rejects cross-user access", async () => {
    const { user: owner, goal } = await createGoalWithRewards("guard");
    const { user: outsider } = await createGoalWithRewards("outsider");
    const board = await rewardsService.getRewardBoard(owner.id, goal.id);
    const finalReward = board.cards.find(
      (card) => card.sourceType === "FINAL_REWARD"
    );

    assert.ok(finalReward);
    await assert.rejects(
      () => rewardsService.deleteRewardCard(owner.id, goal.id, finalReward.id),
      BadRequestException
    );
    await assert.rejects(
      () => rewardsService.getRewardBoard(outsider.id, goal.id),
      NotFoundException
    );
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

async function createGoalWithRewards(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Reward ${scenario}`,
      membership: {
        create: {
          plan: "FREE",
          status: "ACTIVE"
        }
      }
    }
  });
  const goal = await prisma.goal.create({
    data: {
      userId: user.id,
      title: `奖励愿景板测试 ${scenario}`,
      description: "用于验证奖励愿景板 MVP。",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date("2026-06-09T00:00:00.000+08:00"),
      endDate: new Date("2026-06-30T00:00:00.000+08:00"),
      toleranceDaysAllowed: 2,
      finalReward: "兑现最终奖励",
      milestones: {
        create: [
          {
            title: "阶段一",
            description: "完成第一阶段",
            targetDate: new Date("2026-06-16T00:00:00.000+08:00"),
            rewardText: "阶段奖励 1"
          },
          {
            title: "阶段二",
            description: "完成第二阶段",
            targetDate: new Date("2026-06-23T00:00:00.000+08:00"),
            rewardText: "阶段奖励 2"
          }
        ]
      }
    }
  });

  return { user, goal };
}

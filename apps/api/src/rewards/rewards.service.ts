import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Goal, Milestone, RewardCard } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QuotaService } from "../quota/quota.service";
import { FieldEncryptionService } from "../security/field-encryption.service";

type RewardGoal = Goal & {
  milestones: Milestone[];
  rewardCards: RewardCard[];
};

interface RewardCardPayload {
  title: string;
  description?: string | null;
  cardType: string;
  imageUrl?: string | null;
  linkUrl?: string | null;
  sortOrder?: number;
}

const CARD_TYPES = ["TEXT", "IMAGE", "LINK"] as const;
const CUSTOM_SOURCE_TYPE = "CUSTOM";
const FINAL_SOURCE_TYPE = "FINAL_REWARD";
const MILESTONE_SOURCE_TYPE = "MILESTONE_REWARD";
const FREE_CUSTOM_CARD_LIMIT = 5;
const PRO_CUSTOM_CARD_LIMIT = 100;

@Injectable()
export class RewardsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(QuotaService)
    private readonly quotaService: QuotaService = new QuotaService(prisma),
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fields: FieldEncryptionService = new FieldEncryptionService()
  ) {}

  async getRewardBoard(userId: string, goalId: string) {
    const goal = await this.getGoalWithRewards(userId, goalId);
    await this.syncAnchorCards(goal);
    const refreshed = await this.getGoalWithRewards(userId, goalId);

    return this.serializeRewardBoard(refreshed);
  }

  async createRewardCard(userId: string, goalId: string, input: unknown) {
    await this.assertGoalAccess(userId, goalId);
    const payload = this.parseCardPayload(input, true);
    const sortOrder =
      payload.sortOrder ??
      (await this.prisma.rewardCard.count({
        where: { goalId }
      }));
    const cardId = randomUUID();
    const description = this.fields.encryptNullable(payload.description);
    const card = await this.quotaService.runWithQuota(
      userId,
      "REWARD_CARD",
      {
        idempotencyKey: `reward-card:${cardId}`,
        resourceType: "REWARD_CARD",
        resourceId: cardId
      },
      (tx) => tx.rewardCard.create({ data: {
        id: cardId,
        goalId,
        title: payload.title,
        description: description.ciphertext,
        descriptionKeyVersion: description.ciphertext ? description.keyVersion : undefined,
        cardType: payload.cardType,
        sourceType: CUSTOM_SOURCE_TYPE,
        imageUrl: payload.imageUrl,
        linkUrl: payload.linkUrl,
        sortOrder
      } })
    );

    return {
      card: this.serializeRewardCard(card)
    };
  }

  async updateRewardCard(
    userId: string,
    goalId: string,
    cardId: string,
    input: unknown
  ) {
    await this.assertGoalAccess(userId, goalId);
    const card = await this.prisma.rewardCard.findFirst({
      where: {
        id: cardId,
        goalId
      }
    });

    if (!card) {
      throw new NotFoundException("奖励卡片不存在");
    }

    const payload = this.parseCardPayload(input, false);
    const data: Partial<RewardCardPayload> = {};

    if (payload.title) {
      data.title = payload.title;
    }

    if (payload.description !== undefined) {
      const description = this.fields.encryptNullable(payload.description);
      data.description = description.ciphertext;
      (data as { descriptionKeyVersion?: string | null }).descriptionKeyVersion =
        description.ciphertext ? description.keyVersion : null;
    }

    if (payload.cardType) {
      data.cardType = payload.cardType;
    }

    if (payload.imageUrl !== undefined) {
      data.imageUrl = payload.imageUrl;
    }

    if (payload.linkUrl !== undefined) {
      data.linkUrl = payload.linkUrl;
    }

    if (payload.sortOrder !== undefined) {
      data.sortOrder = payload.sortOrder;
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException("没有可更新的奖励卡片内容");
    }

    const updated = await this.prisma.rewardCard.update({
      where: { id: card.id },
      data
    });

    return {
      card: this.serializeRewardCard(updated)
    };
  }

  async deleteRewardCard(userId: string, goalId: string, cardId: string) {
    await this.assertGoalAccess(userId, goalId);
    const card = await this.prisma.rewardCard.findFirst({
      where: {
        id: cardId,
        goalId
      }
    });

    if (!card) {
      throw new NotFoundException("奖励卡片不存在");
    }

    if (card.sourceType !== CUSTOM_SOURCE_TYPE) {
      throw new BadRequestException("目标奖励和阶段奖励会随目标自动维护，不能删除");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rewardCard.delete({ where: { id: card.id } });
      await this.quotaService.releaseWithClient(
        tx,
        userId,
        "REWARD_CARD",
        "REWARD_CARD",
        card.id
      );
    });

    return {
      deletedId: card.id
    };
  }

  private async getGoalWithRewards(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        userId
      },
      include: {
        milestones: {
          orderBy: {
            targetDate: "asc"
          }
        },
        rewardCards: {
          orderBy: [
            {
              sortOrder: "asc"
            },
            {
              createdAt: "asc"
            }
          ]
        }
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    return goal;
  }

  private async assertGoalAccess(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        userId
      },
      select: {
        id: true
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }
  }

  private async syncAnchorCards(goal: RewardGoal) {
    const operations: Promise<unknown>[] = [];

    const finalReward = this.fields.decryptNullable(goal.finalReward);
    if (finalReward?.trim()) {
      operations.push(
        this.upsertAnchorCard({
          goalId: goal.id,
          sourceType: FINAL_SOURCE_TYPE,
          sourceRefId: goal.id,
          title: "最终奖励",
          description: finalReward.trim(),
          sortOrder: 0
        })
      );
    }

    goal.milestones.forEach((milestone, index) => {
      if (!milestone.rewardText?.trim()) {
        return;
      }

      operations.push(
        this.upsertAnchorCard({
          goalId: goal.id,
          sourceType: MILESTONE_SOURCE_TYPE,
          sourceRefId: milestone.id,
          title: milestone.title,
          description: milestone.rewardText.trim(),
          sortOrder: index + 1
        })
      );
    });

    await Promise.all(operations);
  }

  private async upsertAnchorCard(input: {
    goalId: string;
    sourceType: string;
    sourceRefId: string;
    title: string;
    description: string;
    sortOrder: number;
  }) {
    const existing = await this.prisma.rewardCard.findFirst({
      where: {
        goalId: input.goalId,
        sourceType: input.sourceType,
        sourceRefId: input.sourceRefId
      }
    });

    if (existing) {
      const description = this.fields.encrypt(input.description);
      return this.prisma.rewardCard.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          description: description.ciphertext,
          descriptionKeyVersion: description.keyVersion,
          sortOrder: input.sortOrder
        }
      });
    }

    const description = this.fields.encrypt(input.description);
    return this.prisma.rewardCard.create({
      data: {
        goalId: input.goalId,
        sourceType: input.sourceType,
        sourceRefId: input.sourceRefId,
        title: input.title,
        description: description.ciphertext,
        descriptionKeyVersion: description.keyVersion,
        cardType: "TEXT",
        sortOrder: input.sortOrder
      }
    });
  }

  private parseCardPayload(input: unknown, requireTitle: boolean): RewardCardPayload {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const title = this.cleanText(body.title, 80);
    const description = this.cleanOptionalText(body.description, 600);
    const cardType = this.cleanText(body.cardType, 20).toUpperCase() || "TEXT";
    const imageUrl = this.cleanOptionalText(body.imageUrl, 4000);
    const linkUrl = this.cleanOptionalText(body.linkUrl, 1000);
    const sortOrder = this.parseOptionalInteger(body.sortOrder);

    if (requireTitle && !title) {
      throw new BadRequestException("请输入奖励卡片标题");
    }

    if (!CARD_TYPES.includes(cardType as (typeof CARD_TYPES)[number])) {
      throw new BadRequestException("奖励卡片类型不正确");
    }

    if (cardType === "IMAGE" && !imageUrl) {
      throw new BadRequestException("图片奖励卡片需要图片地址或上传图片");
    }

    if (cardType === "LINK" && !linkUrl && !imageUrl) {
      throw new BadRequestException("外链奖励卡片需要链接或外链图片");
    }

    if (sortOrder !== undefined && sortOrder < 0) {
      throw new BadRequestException("排序值必须是非负整数");
    }

    return {
      title,
      description,
      cardType,
      imageUrl,
      linkUrl,
      sortOrder
    };
  }

  private parseOptionalInteger(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const numberValue = Number(value);

    if (!Number.isInteger(numberValue)) {
      throw new BadRequestException("排序值必须是整数");
    }

    return numberValue;
  }

  private cleanText(value: unknown, maxLength: number) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().slice(0, maxLength);
  }

  private cleanOptionalText(value: unknown, maxLength: number) {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (typeof value !== "string") {
      return null;
    }

    const cleaned = value.trim().slice(0, maxLength);
    return cleaned || null;
  }

  private serializeRewardBoard(goal: RewardGoal) {
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      finalReward: this.fields.decryptNullable(goal.finalReward),
      cards: goal.rewardCards.map((card) => this.serializeRewardCard(card)),
      limits: {
        freeCustomCards: FREE_CUSTOM_CARD_LIMIT,
        proCustomCards: PRO_CUSTOM_CARD_LIMIT
      }
    };
  }

  private serializeRewardCard(card: RewardCard) {
    return {
      id: card.id,
      goalId: card.goalId,
      title: card.title,
      description: this.fields.decryptNullable(card.description),
      cardType: card.cardType,
      sourceType: card.sourceType,
      sourceRefId: card.sourceRefId,
      imageUrl: card.imageUrl,
      linkUrl: card.linkUrl,
      sortOrder: card.sortOrder,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString()
    };
  }
}

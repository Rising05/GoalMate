import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const QUOTA_CAPABILITIES = [
  "ACTIVE_GOAL",
  "PLAN_GENERATION",
  "CHECKIN_SCORING",
  "SCORE_APPEAL",
  "GOAL_REPLAN",
  "REPORT_GENERATION",
  "REWARD_CARD",
  "UPLOAD_STORAGE_KIB"
] as const;

export type QuotaCapability = (typeof QUOTA_CAPABILITIES)[number];
type PlanName = "FREE" | "PRO";
type Period = "DAY" | "WEEK" | "MONTH" | "TOTAL";
type DbClient = PrismaService | Prisma.TransactionClient;

interface QuotaDefinition {
  period: Period;
  FREE: number | null;
  PRO: number | null;
}

const DEFINITIONS: Record<QuotaCapability, QuotaDefinition> = {
  ACTIVE_GOAL: { period: "TOTAL", FREE: 1, PRO: null },
  PLAN_GENERATION: { period: "MONTH", FREE: 3, PRO: 30 },
  CHECKIN_SCORING: { period: "DAY", FREE: 3, PRO: 30 },
  SCORE_APPEAL: { period: "WEEK", FREE: 1, PRO: 10 },
  GOAL_REPLAN: { period: "WEEK", FREE: 1, PRO: 10 },
  REPORT_GENERATION: { period: "MONTH", FREE: 1, PRO: 20 },
  REWARD_CARD: { period: "TOTAL", FREE: 5, PRO: 100 },
  UPLOAD_STORAGE_KIB: {
    period: "TOTAL",
    FREE: 50 * 1024,
    PRO: 5 * 1024 * 1024
  }
};

@Injectable()
export class QuotaService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService
  ) {}

  async runWithQuota<T>(
    userId: string,
    capability: QuotaCapability,
    input: {
      idempotencyKey: string;
      quantity?: number;
      resourceType?: string;
      resourceId?: string;
      metadata?: Prisma.InputJsonValue;
      now?: Date;
    },
    operation: (tx: Prisma.TransactionClient) => Promise<T>
  ) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.consumeWithClient(tx, userId, capability, input);
          return operation(tx);
        });
      } catch (error) {
        if (!this.isRetryableTransactionError(error) || attempt === 5) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, attempt * 20));
      }
    }

    throw new Error("Quota transaction retry loop exhausted.");
  }

  async consumeWithClient(
    client: DbClient,
    userId: string,
    capability: QuotaCapability,
    input: {
      idempotencyKey: string;
      quantity?: number;
      resourceType?: string;
      resourceId?: string;
      metadata?: Prisma.InputJsonValue;
      now?: Date;
    }
  ) {
    const quantity = input.quantity ?? 1;
    const now = input.now ?? new Date();

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quota quantity must be a positive integer.");
    }

    const existing = await client.usageRecord.findUnique({
      where: { idempotencyKey: input.idempotencyKey }
    });

    if (existing) {
      return { consumed: false, record: existing };
    }

    const quota = await this.resolveQuota(client, userId, capability, now);
    const period = this.getPeriod(capability, now);

    if (quota.limit !== null) {
      await client.quotaBucket.upsert({
        where: {
          userId_capability_periodKey: {
            userId,
            capability,
            periodKey: period.key
          }
        },
        create: {
          userId,
          capability,
          periodKey: period.key,
          used: 0,
          limitValue: quota.limit,
          resetAt: period.resetAt
        },
        update: {
          limitValue: quota.limit,
          resetAt: period.resetAt
        }
      });
      const updated = await client.quotaBucket.updateMany({
        where: {
          userId,
          capability,
          periodKey: period.key,
          used: { lte: quota.limit - quantity }
        },
        data: { used: { increment: quantity } }
      });

      if (updated.count !== 1) {
        const bucket = await client.quotaBucket.findUnique({
          where: {
            userId_capability_periodKey: {
              userId,
              capability,
              periodKey: period.key
            }
          }
        });
        throw this.quotaExceeded(
          capability,
          bucket?.used ?? quota.limit,
          quota.limit,
          period.resetAt
        );
      }
    }

    const record = await client.usageRecord.create({
      data: {
        userId,
        capability,
        quantity,
        periodKey: period.key,
        idempotencyKey: input.idempotencyKey,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata
      }
    });

    return { consumed: true, record };
  }

  async getSummary(userId: string, now = new Date()) {
    const entries = await Promise.all(
      QUOTA_CAPABILITIES.map(async (capability) => {
        const quota = await this.resolveQuota(this.prisma, userId, capability, now);
        const period = this.getPeriod(capability, now);
        const bucket = await this.prisma.quotaBucket.findUnique({
          where: {
            userId_capability_periodKey: {
              userId,
              capability,
              periodKey: period.key
            }
          }
        });
        return [
          capability,
          {
            used: bucket?.used ?? 0,
            limit: quota.limit,
            resetAt: period.resetAt?.toISOString() ?? null,
            period: DEFINITIONS[capability].period
          }
        ] as const;
      })
    );

    return Object.fromEntries(entries) as Record<
      QuotaCapability,
      { used: number; limit: number | null; resetAt: string | null; period: Period }
    >;
  }

  async releaseWithClient(
    client: DbClient,
    userId: string,
    capability: QuotaCapability,
    resourceType: string,
    resourceId: string,
    now = new Date()
  ) {
    const record = await client.usageRecord.findFirst({
      where: {
        userId,
        capability,
        resourceType,
        resourceId,
        releasedAt: null
      },
      orderBy: { createdAt: "desc" }
    });

    if (!record) return { released: false };

    await client.usageRecord.update({
      where: { id: record.id },
      data: { releasedAt: now }
    });
    await client.quotaBucket.updateMany({
      where: {
        userId,
        capability,
        periodKey: record.periodKey,
        used: { gte: record.quantity }
      },
      data: { used: { decrement: record.quantity } }
    });

    return { released: true };
  }

  async hasProAccess(userId: string, now = new Date()) {
    return (await this.getPlan(this.prisma, userId, now)) === "PRO";
  }

  async assertAvailable(
    userId: string,
    capability: QuotaCapability,
    quantity = 1,
    now = new Date()
  ) {
    const quota = await this.resolveQuota(this.prisma, userId, capability, now);
    if (quota.limit === null) return;
    const period = this.getPeriod(capability, now);
    const bucket = await this.prisma.quotaBucket.findUnique({
      where: {
        userId_capability_periodKey: {
          userId,
          capability,
          periodKey: period.key
        }
      }
    });
    const used = bucket?.used ?? 0;
    if (used + quantity > quota.limit) {
      throw this.quotaExceeded(capability, used, quota.limit, period.resetAt);
    }
  }

  async assertActiveGoalLimit(userId: string, excludingGoalId?: string) {
    const now = new Date();
    const quota = await this.resolveQuota(this.prisma, userId, "ACTIVE_GOAL", now);

    if (quota.limit === null) return;

    const used = await this.prisma.goal.count({
      where: {
        userId,
        id: excludingGoalId ? { not: excludingGoalId } : undefined,
        status: { in: ["ACTIVE", "AT_RISK", "REPLANNING"] }
      }
    });

    if (used >= quota.limit) {
      throw this.quotaExceeded("ACTIVE_GOAL", used, quota.limit, null);
    }
  }

  private async resolveQuota(
    client: DbClient,
    userId: string,
    capability: QuotaCapability,
    now: Date
  ) {
    const entitlement = await client.entitlement.findFirst({
      where: {
        userId,
        capability,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }]
      },
      orderBy: { createdAt: "desc" }
    });

    if (entitlement) {
      return { limit: entitlement.limitValue, source: entitlement.source };
    }

    const plan = await this.getPlan(client, userId, now);
    const systemConfig = await client.systemConfig.findUnique({
      where: { key: "quota.limits" }
    });
    const configured = this.readConfiguredLimit(systemConfig?.value, plan, capability);

    return {
      limit: configured === undefined ? DEFINITIONS[capability][plan] : configured,
      source: configured === undefined ? `PLAN_${plan}` : "SYSTEM_CONFIG"
    };
  }

  private async getPlan(client: DbClient, userId: string, now: Date): Promise<PlanName> {
    const membership = await client.membership.findUnique({ where: { userId } });
    const active = membership &&
      membership.plan === "PRO" &&
      ["ACTIVE", "MANUAL"].includes(membership.status) &&
      (!membership.expiresAt || membership.expiresAt > now);
    return active ? "PRO" : "FREE";
  }

  private readConfiguredLimit(
    value: unknown,
    plan: PlanName,
    capability: QuotaCapability
  ) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const planConfig = (value as Record<string, unknown>)[plan];
    if (!planConfig || typeof planConfig !== "object" || Array.isArray(planConfig)) {
      return undefined;
    }
    const raw = (planConfig as Record<string, unknown>)[capability];
    return raw === null || (Number.isInteger(raw) && Number(raw) >= 0)
      ? raw as number | null
      : undefined;
  }

  private getPeriod(capability: QuotaCapability, now: Date) {
    const period = DEFINITIONS[capability].period;

    if (period === "TOTAL") return { key: "TOTAL", resetAt: null };
    if (period === "DAY") {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const resetAt = new Date(start);
      resetAt.setUTCDate(resetAt.getUTCDate() + 1);
      return { key: start.toISOString().slice(0, 10), resetAt };
    }
    if (period === "WEEK") {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const day = start.getUTCDay() || 7;
      start.setUTCDate(start.getUTCDate() - day + 1);
      const resetAt = new Date(start);
      resetAt.setUTCDate(resetAt.getUTCDate() + 7);
      return { key: `WEEK:${start.toISOString().slice(0, 10)}`, resetAt };
    }
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { key: `MONTH:${start.toISOString().slice(0, 7)}`, resetAt };
  }

  private quotaExceeded(
    capability: QuotaCapability,
    used: number,
    limit: number,
    resetAt: Date | null
  ) {
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: "QUOTA_EXCEEDED",
        capability,
        used,
        limit,
        resetAt: resetAt?.toISOString() ?? null,
        message: `已达到 ${capability} 使用上限`
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private isRetryableTransactionError(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    return ["P2002", "P2034", "P2028"].includes(error.code);
  }
}

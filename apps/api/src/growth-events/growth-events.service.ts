import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { GrowthEvent, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const GROWTH_EVENT_TYPES = [
  "GOAL_CREATED",
  "PLAN_GENERATION_STARTED",
  "PLAN_CONFIRMED",
  "TASK_COMPLETED",
  "CHECKIN_SCORED",
  "SCORE_APPEALED",
  "DEVIATION_DETECTED",
  "RESCUE_TASK_CREATED",
  "RESCUE_TASK_COMPLETED",
  "REPLAN_REQUESTED",
  "REPLAN_CONFIRMED",
  "MILESTONE_REACHED",
  "REPORT_GENERATED",
  "GOAL_COMPLETED",
  "GOAL_FAILED",
  "GOAL_RESTARTED"
] as const;

export type GrowthEventType = (typeof GROWTH_EVENT_TYPES)[number];

type GrowthEventClient = PrismaService | Prisma.TransactionClient;

export interface RecordGrowthEventInput {
  userId: string;
  goalId: string;
  type: GrowthEventType;
  sourceResourceType: string;
  sourceResourceId: string;
  occurredAt?: Date;
  metadata?: Prisma.InputJsonValue;
  derived?: boolean;
}

@Injectable()
export class GrowthEventsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(
    input: RecordGrowthEventInput,
    client: GrowthEventClient = this.prisma
  ) {
    const sourceResourceType = this.cleanSource(input.sourceResourceType);
    const sourceResourceId = this.cleanSource(input.sourceResourceId);

    if (!sourceResourceType || !sourceResourceId) {
      throw new BadRequestException("成长事件缺少来源资源");
    }

    const event = await client.growthEvent.upsert({
      where: {
        type_sourceResourceType_sourceResourceId: {
          type: input.type,
          sourceResourceType,
          sourceResourceId
        }
      },
      create: {
        userId: input.userId,
        goalId: input.goalId,
        type: input.type,
        sourceResourceType,
        sourceResourceId,
        occurredAt: input.occurredAt ?? new Date(),
        metadata: input.metadata,
        derived: input.derived ?? false
      },
      update: {
        userId: input.userId,
        goalId: input.goalId,
        occurredAt: input.occurredAt ?? new Date(),
        metadata: input.metadata,
        derived: input.derived ?? false
      }
    });

    return this.serialize(event);
  }

  async list(userId: string, query: unknown = {}) {
    const filters = this.parseListQuery(query);
    const where: Prisma.GrowthEventWhereInput = { userId };

    if (filters.goalId) {
      where.goalId = filters.goalId;
    }

    if (filters.types.length) {
      where.type = { in: filters.types };
    }

    if (filters.from || filters.to) {
      where.occurredAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lt: filters.to } : {})
      };
    }

    const [events, total] = await Promise.all([
      this.prisma.growthEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: {
          goal: {
            select: {
              title: true
            }
          }
        }
      }),
      this.prisma.growthEvent.count({ where })
    ]);

    return {
      events: events.map((event) => this.serialize(event)),
      total,
      page: filters.page,
      pageSize: filters.pageSize
    };
  }

  serialize(event: GrowthEvent & { goal?: { title: string } }) {
    return {
      id: event.id,
      userId: event.userId,
      goalId: event.goalId,
      goalTitle: event.goal?.title ?? null,
      type: event.type,
      sourceResourceType: event.sourceResourceType,
      sourceResourceId: event.sourceResourceId,
      occurredAt: event.occurredAt.toISOString(),
      metadata: event.metadata,
      derived: event.derived,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString()
    };
  }

  private parseListQuery(input: unknown) {
    const body = input && typeof input === "object"
      ? input as Record<string, unknown>
      : {};
    const page = Math.max(1, Number.isInteger(Number(body.page)) ? Number(body.page) : 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.isInteger(Number(body.pageSize)) ? Number(body.pageSize) : 30)
    );
    const typeInput = typeof body.type === "string" ? body.type : "";
    const types = typeInput
      .split(",")
      .map((type) => type.trim().toUpperCase())
      .filter((type): type is GrowthEventType =>
        GROWTH_EVENT_TYPES.includes(type as GrowthEventType)
      );

    return {
      goalId: typeof body.goalId === "string" ? body.goalId.trim() : "",
      types,
      from: this.parseDateBoundary(body.from, false),
      to: this.parseDateBoundary(body.to, true),
      page,
      pageSize
    };
  }

  private parseDateBoundary(value: unknown, endExclusive: boolean) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException("日期筛选格式必须为 YYYY-MM-DD");
    }

    const date = new Date(`${value}T00:00:00.000+08:00`);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("日期筛选无效");
    }

    if (endExclusive) {
      date.setUTCDate(date.getUTCDate() + 1);
    }

    return date;
  }

  private cleanSource(value: string) {
    return value.trim().slice(0, 191);
  }
}

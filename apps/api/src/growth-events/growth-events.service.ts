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

  async backfillForUser(userId: string) {
    const counts: Record<GrowthEventType, number> = Object.fromEntries(
      GROWTH_EVENT_TYPES.map((type) => [type, 0])
    ) as Record<GrowthEventType, number>;
    const increment = (type: GrowthEventType) => {
      counts[type] += 1;
    };

    const goals = await this.prisma.goal.findMany({
      where: { userId },
      include: {
        plan: true,
        milestones: true,
        dailyTasks: {
          include: {
            checkins: {
              include: {
                aiScore: true,
                scoreAppeals: true
              }
            }
          }
        },
        deviationEvents: true,
        reportArtifacts: true,
        aiJobs: true
      }
    });

    for (const goal of goals) {
      await this.recordDerived({
        userId,
        goalId: goal.id,
        type: "GOAL_CREATED",
        sourceResourceType: "GOAL",
        sourceResourceId: goal.id,
        occurredAt: goal.createdAt,
        metadata: {
          title: goal.title,
          category: goal.category,
          status: goal.status,
          backfill: true
        }
      });
      increment("GOAL_CREATED");

      if (goal.status === "COMPLETED" || goal.status === "FAILED") {
        const type = goal.status === "COMPLETED" ? "GOAL_COMPLETED" : "GOAL_FAILED";
        await this.recordDerived({
          userId,
          goalId: goal.id,
          type,
          sourceResourceType: "GOAL",
          sourceResourceId: goal.id,
          occurredAt: goal.updatedAt,
          metadata: {
            status: goal.status,
            toleranceDaysUsed: goal.toleranceDaysUsed,
            toleranceDaysAllowed: goal.toleranceDaysAllowed,
            backfill: true
          }
        });
        increment(type);
      }

      for (const job of goal.aiJobs) {
        if (job.type === "GOAL_PLAN_GENERATION") {
          await this.recordDerived({
            userId,
            goalId: goal.id,
            type: "PLAN_GENERATION_STARTED",
            sourceResourceType: "AI_JOB",
            sourceResourceId: job.id,
            occurredAt: job.createdAt,
            metadata: {
              jobType: job.type,
              status: job.status,
              backfill: true
            }
          });
          increment("PLAN_GENERATION_STARTED");
        } else if (job.type === "GOAL_PLAN_REPLAN") {
          await this.recordDerived({
            userId,
            goalId: goal.id,
            type: "REPLAN_REQUESTED",
            sourceResourceType: "AI_JOB",
            sourceResourceId: job.id,
            occurredAt: job.createdAt,
            metadata: {
              jobType: job.type,
              status: job.status,
              backfill: true
            }
          });
          increment("REPLAN_REQUESTED");
        }
      }

      if (goal.plan?.confirmedAt) {
        await this.recordDerived({
          userId,
          goalId: goal.id,
          type: "PLAN_CONFIRMED",
          sourceResourceType: "PLAN",
          sourceResourceId: goal.plan.id,
          occurredAt: goal.plan.confirmedAt,
          metadata: {
            planVersion: goal.plan.version,
            backfill: true
          }
        });
        increment("PLAN_CONFIRMED");

        if (goal.plan.version > 1) {
          await this.recordDerived({
            userId,
            goalId: goal.id,
            type: "REPLAN_CONFIRMED",
            sourceResourceType: "PLAN",
            sourceResourceId: goal.plan.id,
            occurredAt: goal.plan.confirmedAt,
            metadata: {
              planVersion: goal.plan.version,
              backfill: true
            }
          });
          increment("REPLAN_CONFIRMED");
        }
      }

      for (const milestone of goal.milestones) {
        if (!milestone.isCompleted) {
          continue;
        }

        await this.recordDerived({
          userId,
          goalId: goal.id,
          type: "MILESTONE_REACHED",
          sourceResourceType: "MILESTONE",
          sourceResourceId: milestone.id,
          occurredAt: milestone.updatedAt,
          metadata: {
            title: milestone.title,
            targetDate: milestone.targetDate.toISOString(),
            backfill: true
          }
        });
        increment("MILESTONE_REACHED");
      }

      for (const task of goal.dailyTasks) {
        const latestCheckin = [...task.checkins].sort(
          (left, right) =>
            right.submittedAt.getTime() - left.submittedAt.getTime()
        )[0];
        const completedAt = latestCheckin?.submittedAt ?? task.updatedAt;

        if (task.taskType === "RESCUE") {
          await this.recordDerived({
            userId,
            goalId: goal.id,
            type: "RESCUE_TASK_CREATED",
            sourceResourceType: "DAILY_TASK",
            sourceResourceId: task.id,
            occurredAt: task.createdAt,
            metadata: {
              title: task.title,
              deviationEventId: task.deviationEventId,
              rescueTriggerCode: task.rescueTriggerCode,
              rescueRiskLevel: task.rescueRiskLevel,
              backfill: true
            }
          });
          increment("RESCUE_TASK_CREATED");
        }

        if (task.status === "DONE" || latestCheckin) {
          await this.recordDerived({
            userId,
            goalId: goal.id,
            type: "TASK_COMPLETED",
            sourceResourceType: "DAILY_TASK",
            sourceResourceId: task.id,
            occurredAt: completedAt,
            metadata: {
              title: task.title,
              taskType: task.taskType,
              checkinId: latestCheckin?.id ?? null,
              investedMinutes: latestCheckin?.investedMinutes ?? null,
              backfill: true
            }
          });
          increment("TASK_COMPLETED");

          if (task.taskType === "RESCUE") {
            await this.recordDerived({
              userId,
              goalId: goal.id,
              type: "RESCUE_TASK_COMPLETED",
              sourceResourceType: "DAILY_TASK",
              sourceResourceId: task.id,
              occurredAt: completedAt,
              metadata: {
                title: task.title,
                checkinId: latestCheckin?.id ?? null,
                deviationEventId: task.deviationEventId,
                backfill: true
              }
            });
            increment("RESCUE_TASK_COMPLETED");
          }
        }

        for (const checkin of task.checkins) {
          if (checkin.aiScore) {
            await this.recordDerived({
              userId,
              goalId: goal.id,
              type: "CHECKIN_SCORED",
              sourceResourceType: "CHECKIN",
              sourceResourceId: checkin.id,
              occurredAt: checkin.aiScore.createdAt,
              metadata: {
                dailyTaskId: task.id,
                aiScoreId: checkin.aiScore.id,
                totalScore: checkin.aiScore.totalScore,
                backfill: true
              }
            });
            increment("CHECKIN_SCORED");
          }

          for (const appeal of checkin.scoreAppeals) {
            await this.recordDerived({
              userId,
              goalId: goal.id,
              type: "SCORE_APPEALED",
              sourceResourceType: "SCORE_APPEAL",
              sourceResourceId: appeal.id,
              occurredAt: appeal.createdAt,
              metadata: {
                checkinId: checkin.id,
                status: appeal.status,
                originalScore: appeal.originalScore,
                newScore: appeal.newScore,
                backfill: true
              }
            });
            increment("SCORE_APPEALED");
          }
        }
      }

      for (const event of goal.deviationEvents) {
        await this.recordDerived({
          userId,
          goalId: goal.id,
          type: "DEVIATION_DETECTED",
          sourceResourceType: "DEVIATION_EVENT",
          sourceResourceId: event.id,
          occurredAt: event.detectedAt,
          metadata: {
            riskLevel: event.riskLevel,
            primaryReasonCode: event.primaryReasonCode,
            primaryReasonLabel: event.primaryReasonLabel,
            sourceDailyTaskId: event.sourceDailyTaskId,
            backfill: true
          }
        });
        increment("DEVIATION_DETECTED");
      }

      for (const artifact of goal.reportArtifacts) {
        await this.recordDerived({
          userId,
          goalId: goal.id,
          type: "REPORT_GENERATED",
          sourceResourceType: "REPORT_ARTIFACT",
          sourceResourceId: artifact.id,
          occurredAt: artifact.createdAt,
          metadata: {
            title: artifact.title,
            reportType: artifact.type,
            periodStart: artifact.periodStart.toISOString(),
            periodEnd: artifact.periodEnd.toISOString(),
            backfill: true
          }
        });
        increment("REPORT_GENERATED");
      }
    }

    return {
      processedGoals: goals.length,
      counts
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

  private recordDerived(input: Omit<RecordGrowthEventInput, "derived">) {
    return this.record({
      ...input,
      derived: true
    });
  }
}

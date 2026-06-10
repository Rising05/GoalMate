import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { AiJob, DailyTask, Goal, Milestone, Plan, WeeklyPlan } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { GeneratedGoalPlan, MockPlanProvider } from "./mock-plan.provider";

const GOAL_PLAN_GENERATION = "GOAL_PLAN_GENERATION";
const GOAL_PLAN_REPLAN = "GOAL_PLAN_REPLAN";
const ACTIVE_GOAL_STATUSES = ["ACTIVE", "AT_RISK", "REPLANNING"] as const;
const FREE_ACTIVE_GOAL_LIMIT = 1;
const PRO_ACTIVE_GOAL_LIMIT = 5;
const MAX_AI_JOB_ATTEMPTS = 3;

type PlanWithItems = Plan & {
  weeklyPlans: Array<WeeklyPlan & { dailyTasks: DailyTask[] }>;
  goal: Goal & { milestones: Milestone[] };
};

@Injectable()
export class AiJobsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(MockPlanProvider)
    private readonly mockPlanProvider: MockPlanProvider
  ) {}

  async generateGoalPlan(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        userId
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    if (!["DRAFT", "GENERATION_FAILED", "WAITING_CONFIRMATION"].includes(goal.status)) {
      throw new BadRequestException("当前目标状态不能生成计划");
    }

    const job = await this.prisma.aiJob.create({
      data: {
        userId,
        goalId,
        type: GOAL_PLAN_GENERATION,
        status: "QUEUED",
        payload: {
          goalId,
          title: goal.title,
          description: goal.description,
          provider: "mock"
        }
      }
    });

    try {
      await this.prisma.goal.update({
        where: { id: goal.id },
        data: { status: "GENERATING_PLAN" }
      });

      const generatedPlan = await this.generatePlanWithRetry(job.id, goal);
      const plan = await this.persistGeneratedPlan(goal, generatedPlan);
      const succeededJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          result: {
            planId: plan.id,
            milestoneCount: plan.goal.milestones.length,
            weeklyPlanCount: plan.weeklyPlans.length,
            dailyTaskCount: plan.weeklyPlans.reduce(
              (count, weeklyPlan) => count + weeklyPlan.dailyTasks.length,
              0
            )
          }
        }
      });

      return {
        job: this.serializeAiJob(succeededJob),
        goal: this.serializeGoal(plan.goal),
        plan: this.serializePlan(plan)
      };
    } catch (error) {
      await this.prisma.goal.update({
        where: { id: goal.id },
        data: { status: "GENERATION_FAILED" }
      });

      const failedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "计划生成失败"
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        goal: await this.getSerializedGoal(userId, goalId),
        plan: null
      };
    }
  }

  async requestGoalReplan(userId: string, goalId: string, input: unknown) {
    const payload = this.parseReplanPayload(input);
    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        userId
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    if (!["ACTIVE", "AT_RISK", "REPLANNING"].includes(goal.status)) {
      throw new BadRequestException("当前目标状态不能调整计划");
    }

    const currentPlan = await this.prisma.plan.findUnique({
      where: { goalId },
      select: { version: true }
    });
    const nextVersion = (currentPlan?.version ?? 0) + 1;
    const updatedGoal = await this.prisma.goal.update({
      where: { id: goal.id },
      data: {
        status: "REPLANNING",
        dailyTimeBudgetMinutes:
          payload.dailyTimeBudgetMinutes ?? goal.dailyTimeBudgetMinutes,
        constraints: payload.constraints ?? goal.constraints,
        currentBaseline: payload.currentBaseline ?? goal.currentBaseline
      }
    });
    const job = await this.prisma.aiJob.create({
      data: {
        userId,
        goalId,
        type: GOAL_PLAN_REPLAN,
        status: "QUEUED",
        payload: {
          goalId,
          previousStatus: goal.status,
          previousPlanVersion: currentPlan?.version ?? null,
          nextPlanVersion: nextVersion,
          adjustmentReason: payload.adjustmentReason,
          constraints: payload.constraints,
          currentBaseline: payload.currentBaseline,
          dailyTimeBudgetMinutes: payload.dailyTimeBudgetMinutes,
          provider: "mock"
        }
      }
    });

    try {
      const generatedPlan = await this.generatePlanWithRetry(job.id, updatedGoal);
      const plan = await this.persistGeneratedPlan(
        updatedGoal,
        generatedPlan,
        nextVersion
      );
      const succeededJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          result: {
            planId: plan.id,
            planVersion: plan.version,
            adjustmentReason: payload.adjustmentReason,
            milestoneCount: plan.goal.milestones.length,
            weeklyPlanCount: plan.weeklyPlans.length,
            dailyTaskCount: plan.weeklyPlans.reduce(
              (count, weeklyPlan) => count + weeklyPlan.dailyTasks.length,
              0
            )
          }
        }
      });

      return {
        job: this.serializeAiJob(succeededJob),
        goal: this.serializeGoal(plan.goal),
        plan: this.serializePlan(plan)
      };
    } catch (error) {
      await this.prisma.goal.update({
        where: { id: goal.id },
        data: { status: "GENERATION_FAILED" }
      });

      const failedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "计划调整失败"
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        goal: await this.getSerializedGoal(userId, goalId),
        plan: null
      };
    }
  }

  async confirmGoalPlan(userId: string, goalId: string) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        goalId,
        goal: {
          userId
        }
      },
      include: this.planInclude()
    });

    if (!plan) {
      throw new NotFoundException("计划不存在");
    }

    if (plan.goal.status !== "WAITING_CONFIRMATION") {
      throw new BadRequestException("当前目标状态不能确认计划");
    }

    await this.assertActiveGoalQuota(userId, goalId);

    const confirmedPlan = await this.prisma.$transaction(async (tx) => {
      await tx.goal.update({
        where: { id: goalId },
        data: { status: "ACTIVE" }
      });

      await tx.plan.update({
        where: { id: plan.id },
        data: {
          isActive: true,
          confirmedAt: new Date()
        }
      });

      return tx.plan.findUniqueOrThrow({
        where: { id: plan.id },
        include: this.planInclude()
      });
    });

    return {
      goal: this.serializeGoal(confirmedPlan.goal),
      plan: this.serializePlan(confirmedPlan)
    };
  }

  async getGoalPlan(userId: string, goalId: string) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        goalId,
        goal: {
          userId
        }
      },
      include: this.planInclude()
    });

    if (!plan) {
      throw new NotFoundException("计划不存在");
    }

    return {
      plan: this.serializePlan(plan)
    };
  }

  private parseReplanPayload(input: unknown) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const adjustmentReason = this.cleanText(body.adjustmentReason, 1000);
    const constraints = this.cleanText(body.constraints, 2000);
    const currentBaseline = this.cleanText(body.currentBaseline, 2000);
    const dailyTimeBudgetMinutes = this.parseOptionalInteger(
      body.dailyTimeBudgetMinutes,
      "每日投入时间必须是正整数"
    );

    if (adjustmentReason.length < 8) {
      throw new BadRequestException("请说明为什么需要调整计划");
    }

    if (
      dailyTimeBudgetMinutes !== undefined &&
      (dailyTimeBudgetMinutes < 5 || dailyTimeBudgetMinutes > 600)
    ) {
      throw new BadRequestException("每日投入时间必须在 5 到 600 分钟之间");
    }

    return {
      adjustmentReason,
      constraints: constraints || undefined,
      currentBaseline: currentBaseline || undefined,
      dailyTimeBudgetMinutes
    };
  }

  private async generatePlanWithRetry(jobId: string, goal: Goal) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_AI_JOB_ATTEMPTS; attempt += 1) {
      await this.prisma.aiJob.update({
        where: { id: jobId },
        data: {
          status: attempt === 1 ? "RUNNING" : "RETRYING",
          attempts: {
            increment: 1
          },
          error:
            attempt === 1
              ? null
              : lastError instanceof Error
                ? lastError.message
                : "AI 调用失败，正在重试"
        }
      });

      try {
        return this.mockPlanProvider.generate(goal);
      } catch (error) {
        lastError = error;

        if (attempt < MAX_AI_JOB_ATTEMPTS) {
          await this.prisma.aiJob.update({
            where: { id: jobId },
            data: {
              status: "RETRYING",
              error: error instanceof Error ? error.message : "AI 调用失败，正在重试"
            }
          });
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("AI 调用失败");
  }

  private cleanText(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }

  private parseOptionalInteger(value: unknown, errorMessage: string) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const numberValue = Number(value);

    if (!Number.isInteger(numberValue)) {
      throw new BadRequestException(errorMessage);
    }

    return numberValue;
  }

  private async assertActiveGoalQuota(userId: string, goalId: string) {
    const [membership, activeGoalCount] = await Promise.all([
      this.prisma.membership.findUnique({
        where: { userId }
      }),
      this.prisma.goal.count({
        where: {
          userId,
          id: {
            not: goalId
          },
          status: {
            in: [...ACTIVE_GOAL_STATUSES]
          }
        }
      })
    ]);
    const hasProAccess =
      membership?.plan === "PRO" &&
      ["ACTIVE", "MANUAL"].includes(membership.status) &&
      (!membership.expiresAt || membership.expiresAt > new Date());
    const limit = hasProAccess ? PRO_ACTIVE_GOAL_LIMIT : FREE_ACTIVE_GOAL_LIMIT;

    if (activeGoalCount >= limit) {
      throw new BadRequestException(
        hasProAccess
          ? `当前会员最多可同时执行 ${limit} 个目标`
          : "免费版同时只能执行 1 个目标，请完成、失败归档或升级会员后再确认新计划"
      );
    }
  }

  private async persistGeneratedPlan(
    goal: Goal,
    generatedPlan: GeneratedGoalPlan,
    version = 1
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.dailyTask.deleteMany({ where: { goalId: goal.id } });
      await tx.milestone.deleteMany({ where: { goalId: goal.id } });
      await tx.plan.deleteMany({ where: { goalId: goal.id } });

      const plan = await tx.plan.create({
        data: {
          goalId: goal.id,
          version,
          summary: generatedPlan.summary,
          isActive: false
        }
      });

      await tx.milestone.createMany({
        data: generatedPlan.milestones.map((milestone) => ({
          goalId: goal.id,
          title: milestone.title,
          description: milestone.description,
          targetDate: milestone.targetDate,
          rewardText: milestone.rewardText
        }))
      });

      for (const weeklyPlan of generatedPlan.weeklyPlans) {
        const createdWeeklyPlan = await tx.weeklyPlan.create({
          data: {
            planId: plan.id,
            weekIndex: weeklyPlan.weekIndex,
            title: weeklyPlan.title,
            summary: weeklyPlan.summary,
            startsOn: weeklyPlan.startsOn,
            endsOn: weeklyPlan.endsOn
          }
        });

        await tx.dailyTask.createMany({
          data: weeklyPlan.dailyTasks.map((task) => ({
            goalId: goal.id,
            weeklyPlanId: createdWeeklyPlan.id,
            taskDate: task.taskDate,
            title: task.title,
            description: task.description,
            plannedMinutes: task.plannedMinutes
          }))
        });
      }

      await tx.goal.update({
        where: { id: goal.id },
        data: { status: "WAITING_CONFIRMATION" }
      });

      return tx.plan.findUniqueOrThrow({
        where: { id: plan.id },
        include: this.planInclude()
      });
    });
  }

  private planInclude() {
    return {
      goal: {
        include: {
          milestones: {
            orderBy: {
              targetDate: "asc" as const
            }
          }
        }
      },
      weeklyPlans: {
        orderBy: {
          weekIndex: "asc" as const
        },
        include: {
          dailyTasks: {
            orderBy: {
              taskDate: "asc" as const
            }
          }
        }
      }
    };
  }

  private async getSerializedGoal(userId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirstOrThrow({
      where: {
        id: goalId,
        userId
      }
    });

    return this.serializeGoal(goal);
  }

  private serializeGoal(goal: Goal) {
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      category: goal.category,
      status: goal.status,
      startDate: goal.startDate.toISOString(),
      endDate: goal.endDate.toISOString(),
      timezone: goal.timezone,
      toleranceDaysAllowed: goal.toleranceDaysAllowed,
      toleranceDaysUsed: goal.toleranceDaysUsed,
      dailyTimeBudgetMinutes: goal.dailyTimeBudgetMinutes,
      currentBaseline: goal.currentBaseline,
      constraints: goal.constraints,
      finalReward: goal.finalReward,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString()
    };
  }

  private serializeAiJob(job: AiJob) {
    return {
      id: job.id,
      userId: job.userId,
      goalId: job.goalId,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      payload: job.payload,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    };
  }

  private serializePlan(plan: PlanWithItems) {
    return {
      id: plan.id,
      goalId: plan.goalId,
      version: plan.version,
      summary: plan.summary,
      isActive: plan.isActive,
      confirmedAt: plan.confirmedAt?.toISOString() ?? null,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      milestones: plan.goal.milestones.map((milestone) => ({
        id: milestone.id,
        goalId: milestone.goalId,
        title: milestone.title,
        description: milestone.description,
        targetDate: milestone.targetDate.toISOString(),
        rewardText: milestone.rewardText,
        isCompleted: milestone.isCompleted
      })),
      weeklyPlans: plan.weeklyPlans.map((weeklyPlan) => ({
        id: weeklyPlan.id,
        planId: weeklyPlan.planId,
        weekIndex: weeklyPlan.weekIndex,
        title: weeklyPlan.title,
        summary: weeklyPlan.summary,
        startsOn: weeklyPlan.startsOn.toISOString(),
        endsOn: weeklyPlan.endsOn.toISOString(),
        dailyTasks: weeklyPlan.dailyTasks.map((task) => ({
          id: task.id,
          goalId: task.goalId,
          weeklyPlanId: task.weeklyPlanId,
          taskDate: task.taskDate.toISOString(),
          title: task.title,
          description: task.description,
          plannedMinutes: task.plannedMinutes,
          status: task.status
        }))
      }))
    };
  }
}

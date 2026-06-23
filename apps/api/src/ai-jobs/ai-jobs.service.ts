import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  AiJob,
  DailyTask,
  Goal,
  Milestone,
  Plan,
  Prisma,
  WeeklyPlan
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { GeneratedGoalPlan, MockPlanProvider } from "./mock-plan.provider";
import { PLAN_PROVIDER, PlanProvider } from "./plan-provider";
import { QuotaService } from "../quota/quota.service";
import { TraceContextService } from "../observability/trace-context.service";
import { randomUUID } from "node:crypto";
import { FieldEncryptionService } from "../security/field-encryption.service";

const GOAL_PLAN_GENERATION = "GOAL_PLAN_GENERATION";
const GOAL_PLAN_REPLAN = "GOAL_PLAN_REPLAN";
const ACTIVE_GOAL_STATUSES = ["ACTIVE", "AT_RISK", "REPLANNING"] as const;
const FREE_ACTIVE_GOAL_LIMIT = 1;
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
    @Inject(PLAN_PROVIDER)
    private readonly planProvider: PlanProvider = new MockPlanProvider(),
    @Optional()
    @Inject(QueueService)
    private readonly queueService?: QueueService,
    @Optional()
    @Inject(QuotaService)
    private readonly quotaService: QuotaService = new QuotaService(prisma),
    @Optional()
    @Inject(TraceContextService)
    private readonly traces: TraceContextService = new TraceContextService(),
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fields: FieldEncryptionService = new FieldEncryptionService()
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

    const jobId = randomUUID();
    const createdJob = await this.quotaService.runWithQuota(
      userId,
      "PLAN_GENERATION",
      {
        idempotencyKey: `plan-generation:${jobId}`,
        resourceType: "AI_JOB",
        resourceId: jobId
      },
      (tx) => tx.aiJob.create({ data: {
        id: jobId,
        traceId: this.traces.getTraceId(),
        userId,
        goalId,
        type: GOAL_PLAN_GENERATION,
        status: "QUEUED",
        payload: {
          goalId,
          provider: this.planProvider.name,
          inputSummary: {
            hasDescription: Boolean(goal.description),
            category: goal.category,
            hasExamDate: Boolean(goal.examDate),
            subjectCount: this.jsonArray(goal.subjects).length,
            materialCount: this.jsonArray(goal.materials).length
          }
        }
      } })
    );
    const job = await this.attachQueueMetadata(createdJob);

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
    const encryptedConstraints = this.fields.encryptNullable(payload.constraints);
    const encryptedCurrentBaseline = this.fields.encryptNullable(payload.currentBaseline);
    const nextVersion = (currentPlan?.version ?? 0) + 1;
    const jobId = randomUUID();
    const { updatedGoal, createdJob } = await this.quotaService.runWithQuota(
      userId,
      "GOAL_REPLAN",
      {
        idempotencyKey: `goal-replan:${jobId}`,
        resourceType: "AI_JOB",
        resourceId: jobId
      },
      async (tx) => {
        const updatedGoal = await tx.goal.update({
          where: { id: goal.id },
          data: {
            status: "REPLANNING",
            dailyTimeBudgetMinutes:
              payload.dailyTimeBudgetMinutes ?? goal.dailyTimeBudgetMinutes,
            constraints: payload.constraints !== undefined
              ? encryptedConstraints.ciphertext
              : goal.constraints,
            constraintsKeyVersion: payload.constraints !== undefined
              ? (encryptedConstraints.ciphertext ? encryptedConstraints.keyVersion : null)
              : goal.constraintsKeyVersion,
            currentBaseline: payload.currentBaseline !== undefined
              ? encryptedCurrentBaseline.ciphertext
              : goal.currentBaseline,
            currentBaselineKeyVersion: payload.currentBaseline !== undefined
              ? (encryptedCurrentBaseline.ciphertext ? encryptedCurrentBaseline.keyVersion : null)
              : goal.currentBaselineKeyVersion
          }
        });
        const createdJob = await tx.aiJob.create({
          data: {
            id: jobId,
            traceId: this.traces.getTraceId(),
            userId,
            goalId,
            type: GOAL_PLAN_REPLAN,
            status: "QUEUED",
            payload: {
              goalId,
              previousStatus: goal.status,
              previousPlanVersion: currentPlan?.version ?? null,
              nextPlanVersion: nextVersion,
              adjustmentReasonLength: payload.adjustmentReason.length,
              constraintsUpdated: payload.constraints !== undefined,
              currentBaselineUpdated: payload.currentBaseline !== undefined,
              dailyTimeBudgetMinutes: payload.dailyTimeBudgetMinutes,
              provider: this.planProvider.name
            }
          }
        });

        return { updatedGoal, createdJob };
      }
    );
    const job = await this.attachQueueMetadata(createdJob);

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

  async getJob(userId: string, id: string) {
    const job = await this.prisma.aiJob.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!job) {
      throw new NotFoundException("AI 任务不存在");
    }

    return {
      job: this.serializeAiJob(job)
    };
  }

  async cancelJob(userId: string, id: string, input: unknown = {}) {
    const job = await this.prisma.aiJob.findFirst({
      where: {
        id,
        userId
      },
      include: {
        goal: true
      }
    });

    if (!job) {
      throw new NotFoundException("AI 任务不存在");
    }

    if (job.status === "CANCELLED") {
      return {
        job: this.serializeAiJob(job),
        cancelled: false,
        reason: "AI job is already cancelled."
      };
    }

    if (job.status !== "QUEUED") {
      throw new BadRequestException("当前 AI 任务状态不能取消");
    }

    const reason = this.parseCancelReason(input);
    const payload = this.jsonObject(job.payload);
    const nextGoalStatus = this.getCancelledJobGoalStatus(job, payload);
    const cancelledJob = await this.prisma.$transaction(async (tx) => {
      if (job.goalId && nextGoalStatus) {
        await tx.goal.update({
          where: { id: job.goalId },
          data: { status: nextGoalStatus }
        });
      }

      const capability = job.type === GOAL_PLAN_GENERATION
        ? "PLAN_GENERATION"
        : job.type === GOAL_PLAN_REPLAN
          ? "GOAL_REPLAN"
          : job.type === "CHECKIN_SCORING"
            ? "CHECKIN_SCORING"
            : job.type === "CHECKIN_SCORE_APPEAL"
              ? "SCORE_APPEAL"
              : null;

      if (capability) {
        await this.quotaService.releaseWithClient(
          tx,
          userId,
          capability,
          "AI_JOB",
          job.id
        );
      }

      return tx.aiJob.update({
        where: { id: job.id },
        data: {
          status: "CANCELLED",
          error: reason,
          result: this.toJson({
            cancelledAt: new Date().toISOString(),
            reason,
            restoredGoalStatus: nextGoalStatus
          }),
          payload: this.toJson({
            ...payload,
            cancellation: {
              requestedBy: userId,
              reason
            }
          })
        }
      });
    });

    return {
      job: this.serializeAiJob(cancelledJob),
      cancelled: true
    };
  }

  async processQueuedAiJob(id: string) {
    const job = await this.prisma.aiJob.findUnique({
      where: { id },
      include: { goal: true }
    });

    if (!job) {
      throw new NotFoundException("AI 任务不存在");
    }

    if (job.status !== "QUEUED") {
      return {
        job: this.serializeAiJob(job),
        processed: false,
        reason: "AI job is not queued."
      };
    }

    if (!job.goal) {
      const failedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: "AI job has no target goal."
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        processed: true,
        plan: null
      };
    }

    if (![GOAL_PLAN_GENERATION, GOAL_PLAN_REPLAN].includes(job.type)) {
      const failedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: `Unsupported AI job type: ${job.type}`
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        processed: true,
        plan: null
      };
    }

    const payload = this.jsonObject(job.payload);
    const nextPlanVersion =
      job.type === GOAL_PLAN_REPLAN
        ? this.parsePayloadInteger(payload.nextPlanVersion, 2)
        : 1;

    try {
      await this.prisma.goal.update({
        where: { id: job.goal.id },
        data: {
          status:
            job.type === GOAL_PLAN_REPLAN ? "REPLANNING" : "GENERATING_PLAN"
        }
      });
      const generatedPlan = await this.generatePlanWithRetry(job.id, job.goal);
      const plan = await this.persistGeneratedPlan(
        job.goal,
        generatedPlan,
        nextPlanVersion
      );
      const succeededJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          result: {
            planId: plan.id,
            planVersion: plan.version,
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
        processed: true,
        plan: this.serializePlan(plan)
      };
    } catch (error) {
      await this.prisma.goal.update({
        where: { id: job.goal.id },
        data: { status: "GENERATION_FAILED" }
      });

      const failedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "AI worker failed"
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        processed: true,
        plan: null
      };
    }
  }

  private async attachQueueMetadata(job: AiJob) {
    const payload = this.jsonObject(job.payload);

    try {
      const queue = await this.queueService?.enqueueAiJob({
        jobId: job.id,
        type: job.type,
        goalId: job.goalId,
        userId: job.userId
      });

      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          payload: this.toJson({
            ...payload,
            queue: queue ?? {
              queued: false,
              queueName: "ai-jobs",
              reason: "Queue service is not configured."
            }
          })
        }
      });
    } catch (error) {
      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          payload: this.toJson({
            ...payload,
            queue: {
              queued: false,
              queueName: "ai-jobs",
              error: error instanceof Error ? error.message : "Queue enqueue failed"
            }
          })
        }
      });
    }
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

  private parseCancelReason(input: unknown) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const reason = this.cleanText(body.reason, 300);

    return reason || "用户取消 AI 任务";
  }

  private getCancelledJobGoalStatus(
    job: AiJob & { goal: Goal | null },
    payload: Record<string, unknown>
  ): Goal["status"] | null {
    if (!job.goal) {
      return null;
    }

    if (job.type === GOAL_PLAN_REPLAN) {
      const previousStatus =
        typeof payload.previousStatus === "string"
          ? payload.previousStatus.trim().toUpperCase()
          : "";

      if (["ACTIVE", "AT_RISK", "REPLANNING"].includes(previousStatus)) {
        return previousStatus as Goal["status"];
      }

      return ["ACTIVE", "AT_RISK", "REPLANNING"].includes(job.goal.status)
        ? job.goal.status
        : "ACTIVE";
    }

    if (job.type === GOAL_PLAN_GENERATION) {
      return "DRAFT";
    }

    return null;
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
        return await this.planProvider.generate(this.decryptGoal(goal), {
          userId: goal.userId,
          goalId: goal.id,
          aiJobId: jobId,
          attempt
        });
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

  private jsonObject(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
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

  private parsePayloadInteger(value: unknown, fallback: number) {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async assertActiveGoalQuota(userId: string, goalId: string) {
    await this.quotaService.assertActiveGoalLimit(userId, goalId);
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
            plannedMinutes: task.plannedMinutes,
            studyTaskType: task.studyTaskType,
            subject: task.subject,
            materialRef: task.materialRef,
            chapterRef: task.chapterRef,
            questionCount: task.questionCount,
            targetAccuracy: task.targetAccuracy,
            evidenceRequired: task.evidenceRequired ?? false,
            priority: task.priority
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
    const plainGoal = this.decryptGoal(goal);
    return {
      id: goal.id,
      title: goal.title,
      description: plainGoal.description,
      category: goal.category,
      status: goal.status,
      startDate: goal.startDate.toISOString(),
      endDate: goal.endDate.toISOString(),
      timezone: goal.timezone,
      toleranceDaysAllowed: goal.toleranceDaysAllowed,
      toleranceDaysUsed: goal.toleranceDaysUsed,
      dailyTimeBudgetMinutes: goal.dailyTimeBudgetMinutes,
      examName: goal.examName,
      targetScore: goal.targetScore,
      currentScore: goal.currentScore,
      examDate: goal.examDate?.toISOString() ?? null,
      subjects: this.jsonArray(goal.subjects),
      materials: this.jsonArray(goal.materials),
      chapters: this.jsonArray(goal.chapters),
      weaknesses: this.jsonArray(goal.weaknesses),
      studyDaysPerWeek: goal.studyDaysPerWeek,
      dailyStudyMinutes: goal.dailyStudyMinutes,
      mockExamFrequency: goal.mockExamFrequency,
      currentBaseline: plainGoal.currentBaseline,
      constraints: plainGoal.constraints,
      finalReward: plainGoal.finalReward,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString()
    };
  }

  private decryptGoal<T extends Goal>(goal: T): T {
    return {
      ...goal,
      description: this.fields.decrypt(goal.description),
      currentBaseline: this.fields.decryptNullable(goal.currentBaseline),
      constraints: this.fields.decryptNullable(goal.constraints),
      finalReward: this.fields.decryptNullable(goal.finalReward)
    };
  }

  private serializeAiJob(job: AiJob) {
    return {
      id: job.id,
      traceId: job.traceId,
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
          studyTaskType: task.studyTaskType,
          subject: task.subject,
          materialRef: task.materialRef,
          chapterRef: task.chapterRef,
          questionCount: task.questionCount,
          targetAccuracy: task.targetAccuracy,
          evidenceRequired: task.evidenceRequired,
          priority: task.priority,
          status: task.status
        }))
      }))
    };
  }

  private jsonArray(value: unknown) {
    return Array.isArray(value) ? value : [];
  }
}

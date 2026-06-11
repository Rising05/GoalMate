import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  AiScore,
  AiJob,
  Checkin,
  DailyTask,
  DeviationEvent,
  Goal,
  GoalStatus,
  Prisma,
  WeeklyPlan
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { MockScoringProvider } from "./mock-scoring.provider";
import { SCORING_PROVIDER, ScoringProvider } from "./scoring-provider";

type TaskWithGoalAndCheckins = DailyTask & {
  goal: Goal;
  weeklyPlan: WeeklyPlan | null;
  checkins: Array<Checkin & { aiScore: AiScore | null }>;
};

type TimelineCheckin = Checkin & {
  goal: Goal;
  dailyTask:
    | (DailyTask & {
        weeklyPlan: WeeklyPlan | null;
      })
    | null;
  aiScore: AiScore | null;
};

type TimelineSourceTask = DailyTask & {
  weeklyPlan: WeeklyPlan | null;
};

type TimelineRescueTask = DailyTask & {
  weeklyPlan: WeeklyPlan | null;
  checkins: Array<Checkin & { aiScore: AiScore | null }>;
};

type TimelineDeviationEvent = DeviationEvent & {
  goal: Goal;
  rescueTasks: TimelineRescueTask[];
};

interface TimelineDeviationReason {
  code: string;
  level: string;
  label: string;
  detail: string;
}

interface TimelineDeviationMetrics {
  averageScore: number | null;
  recentInvestedMinutes: number;
  expectedRecentMinutes: number;
  streakDays: number;
  overdueTaskCount: number;
  incompleteTodayTaskCount: number;
}

interface CompleteTaskPayload {
  content: string;
  investedMinutes?: number;
}

interface ScoreAppealPayload {
  reason: string;
  addedFacts: string;
}

const EXECUTABLE_GOAL_STATUSES: GoalStatus[] = [
  "ACTIVE",
  "AT_RISK",
  "REPLANNING"
];
const DONE_STATUS = "DONE";
const RESCUE_TASK_TYPE = "RESCUE";
const TIMEZONE = "Asia/Shanghai";
const CHECKIN_SCORING = "CHECKIN_SCORING";
const CHECKIN_SCORE_APPEAL = "CHECKIN_SCORE_APPEAL";

@Injectable()
export class DailyTasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(SCORING_PROVIDER)
    private readonly scoringProvider: ScoringProvider = new MockScoringProvider(),
    @Optional()
    @Inject(QueueService)
    private readonly queueService?: QueueService
  ) {}

  async getTodayTasks(userId: string, goalId?: string) {
    const today = this.toDateKey(new Date());
    const { start, end } = this.getDateRange(today);
    const goalFilter = await this.getGoalFilter(userId, goalId);
    const tasks = await this.prisma.dailyTask.findMany({
      where: {
        taskDate: {
          gte: start,
          lt: end
        },
        goal: goalFilter
      },
      orderBy: {
        createdAt: "asc"
      },
      include: this.taskInclude()
    });

    return {
      date: today,
      tasks: tasks.map((task) => this.serializeTask(task))
    };
  }

  async getYearActivity(userId: string, rawYear?: string, goalId?: string) {
    const year = this.parseYear(rawYear);
    const { start, end } = this.getYearRange(year);
    const goalFilter = await this.getGoalFilter(userId, goalId);
    const tasks = await this.prisma.dailyTask.findMany({
      where: {
        taskDate: {
          gte: start,
          lt: end
        },
        goal: goalFilter
      },
      orderBy: {
        taskDate: "asc"
      },
      include: this.taskInclude()
    });
    const days = new Map<
      string,
      {
        date: string;
        totalTaskCount: number;
        completedTaskCount: number;
        plannedMinutes: number;
        investedMinutes: number;
        scoreTotal: number;
        scoreCount: number;
        tasks: ReturnType<DailyTasksService["serializeActivityTask"]>[];
      }
    >();

    for (const task of tasks) {
      const date = this.toDateKey(task.taskDate);
      const bucket =
        days.get(date) ??
        {
          date,
          totalTaskCount: 0,
          completedTaskCount: 0,
          plannedMinutes: 0,
          investedMinutes: 0,
          scoreTotal: 0,
          scoreCount: 0,
          tasks: []
      };
      const completedCheckins = task.checkins.filter((checkin) => checkin.aiScore);
      const isCompleted = task.status === DONE_STATUS || completedCheckins.length > 0;
      bucket.totalTaskCount += 1;
      bucket.plannedMinutes += task.plannedMinutes ?? 0;

      if (isCompleted) {
        bucket.completedTaskCount += 1;
        bucket.tasks.push(this.serializeActivityTask(task));
      }

      for (const checkin of task.checkins) {
        bucket.investedMinutes += checkin.investedMinutes ?? 0;

        if (checkin.aiScore) {
          bucket.scoreTotal += checkin.aiScore.totalScore;
          bucket.scoreCount += 1;
        }
      }

      days.set(date, bucket);
    }

    return {
      year,
      days: Array.from(days.values()).map((day) => {
        const averageScore = day.scoreCount
          ? Math.round(day.scoreTotal / day.scoreCount)
          : null;
        const completionRate = day.totalTaskCount
          ? Math.round((day.completedTaskCount / day.totalTaskCount) * 100)
          : 0;
        const healthScore = this.getActivityHealthScore({
          completionRate,
          averageScore,
          investedMinutes: day.investedMinutes,
          plannedMinutes: day.plannedMinutes
        });

        return {
          date: day.date,
          level: this.getActivityLevel(healthScore),
          healthScore,
          completionRate,
          totalTaskCount: day.totalTaskCount,
          completedTaskCount: day.completedTaskCount,
          plannedMinutes: day.plannedMinutes,
          investedMinutes: day.investedMinutes,
          averageScore,
          tasks: day.tasks
        };
      })
    };
  }

  async getTimeline(userId: string, goalId?: string) {
    const goalFilter = await this.getGoalFilter(userId, goalId);
    const [checkins, deviationEvents] = await Promise.all([
      this.prisma.checkin.findMany({
        where: {
          userId,
          goal: goalFilter
        },
        orderBy: {
          submittedAt: "desc"
        },
        take: 60,
        include: {
          goal: true,
          dailyTask: {
            include: {
              weeklyPlan: true
            }
          },
          aiScore: true
        }
      }),
      this.prisma.deviationEvent.findMany({
        where: {
          goal: goalFilter
        },
        orderBy: {
          detectedAt: "desc"
        },
        take: 30,
        include: {
          goal: true,
          rescueTasks: {
            orderBy: {
              createdAt: "asc"
            },
            include: {
              weeklyPlan: true,
              checkins: {
                orderBy: {
                  submittedAt: "desc"
                },
                include: {
                  aiScore: true
                }
              }
            }
          }
        }
      })
    ]);
    const sourceTasks = await this.getTimelineSourceTasks(
      deviationEvents.map((event) => event.sourceDailyTaskId)
    );
    const checkinItems = checkins.map((checkin) =>
      this.serializeTimelineCheckinItem(checkin)
    );
    const deviationItems = deviationEvents.map((event) =>
      this.serializeTimelineDeviationItem(event, sourceTasks.get(event.sourceDailyTaskId ?? ""))
    );
    const items = [...checkinItems, ...deviationItems].sort(
      (left, right) =>
        new Date(right.timelineAt).getTime() - new Date(left.timelineAt).getTime()
    );
    const days = new Map<
      string,
      {
        date: string;
        investedMinutes: number;
        scoreTotal: number;
        scoreCount: number;
        items: typeof items;
      }
    >();

    for (const item of items) {
      const bucket =
        days.get(item.date) ??
        {
          date: item.date,
          investedMinutes: 0,
          scoreTotal: 0,
          scoreCount: 0,
          items: []
        };

      if (item.kind === "CHECKIN") {
        bucket.investedMinutes += item.investedMinutes ?? 0;

        if (item.aiScore) {
          bucket.scoreTotal += item.aiScore.totalScore;
          bucket.scoreCount += 1;
        }
      }

      bucket.items.push(item);
      days.set(item.date, bucket);
    }

    return {
      items,
      days: Array.from(days.values()).map((day) => ({
        date: day.date,
        investedMinutes: day.investedMinutes,
        averageScore: day.scoreCount
          ? Math.round(day.scoreTotal / day.scoreCount)
          : null,
        items: day.items
      }))
    };
  }

  private async getTimelineSourceTasks(sourceDailyTaskIds: Array<string | null>) {
    const ids = Array.from(
      new Set(sourceDailyTaskIds.filter((id): id is string => Boolean(id)))
    );

    if (!ids.length) {
      return new Map<string, TimelineSourceTask>();
    }

    const tasks = await this.prisma.dailyTask.findMany({
      where: {
        id: {
          in: ids
        }
      },
      include: {
        weeklyPlan: true
      }
    });

    return new Map(tasks.map((task) => [task.id, task]));
  }

  async completeTask(userId: string, taskId: string, input: unknown) {
    const payload = this.parseCompletePayload(input);
    const task = await this.prisma.dailyTask.findFirst({
      where: {
        id: taskId,
        goal: {
          userId,
          status: {
            in: EXECUTABLE_GOAL_STATUSES
          }
        }
      },
      include: this.taskInclude()
    });

    if (!task) {
      throw new NotFoundException("任务不存在或当前不可执行");
    }

    if (task.status === DONE_STATUS) {
      throw new BadRequestException("任务已完成");
    }

    const investedMinutes = payload.investedMinutes ?? task.plannedMinutes ?? 0;
    const score = await this.scoringProvider.score({
      content: payload.content,
      investedMinutes,
      task
    });
    const { completedTask, checkin, job } = await this.prisma.$transaction(async (tx) => {
      await tx.dailyTask.update({
        where: { id: task.id },
        data: { status: DONE_STATUS }
      });

      const createdCheckin = await tx.checkin.create({
        data: {
          userId,
          goalId: task.goalId,
          dailyTaskId: task.id,
          status: "SCORED",
          content: payload.content,
          investedMinutes
        }
      });

      const createdJob = await tx.aiJob.create({
        data: {
          userId,
          goalId: task.goalId,
          type: CHECKIN_SCORING,
          status: "QUEUED",
          payload: {
            checkinId: createdCheckin.id,
            dailyTaskId: task.id,
            taskType: task.taskType,
            deviationEventId: task.deviationEventId,
            provider: this.scoringProvider.name
          }
        }
      });

      const runningJob = await tx.aiJob.update({
        where: { id: createdJob.id },
        data: {
          status: "RUNNING",
          attempts: {
            increment: 1
          }
        }
      });

      const aiScore = await tx.aiScore.create({
        data: {
          checkinId: createdCheckin.id,
          totalScore: score.totalScore,
          dimensions: this.toJson(score.dimensions),
          evidence: this.toJson(score.evidence),
          summary: score.summary,
          suggestion: score.suggestion
        }
      });

      const succeededJob = await tx.aiJob.update({
        where: { id: runningJob.id },
        data: {
          status: "SUCCEEDED",
          result: {
            checkinId: createdCheckin.id,
            aiScoreId: aiScore.id,
            totalScore: score.totalScore
          }
        }
      });

      const updatedTask = await tx.dailyTask.findUniqueOrThrow({
        where: { id: task.id },
        include: this.taskInclude()
      });

      return {
        completedTask: updatedTask,
        checkin: updatedTask.checkins.find((item) => item.id === createdCheckin.id)!,
        job: succeededJob
      };
    });
    const queuedJob = await this.attachQueueMetadata(job);

    return {
      task: this.serializeTask(completedTask),
      checkin: this.serializeCheckin(checkin),
      job: this.serializeAiJob(queuedJob)
    };
  }

  async appealCheckinScore(userId: string, checkinId: string, input: unknown) {
    const payload = this.parseScoreAppealPayload(input);
    const checkin = await this.prisma.checkin.findFirst({
      where: {
        id: checkinId,
        userId
      },
      include: {
        aiScore: true,
        dailyTask: {
          include: {
            goal: true,
            weeklyPlan: true,
            checkins: {
              include: {
                aiScore: true
              }
            }
          }
        }
      }
    });

    if (!checkin || !checkin.aiScore) {
      throw new NotFoundException("复盘评分不存在");
    }

    const appealResult = this.getMockAppealResult(payload, checkin.aiScore.totalScore);
    const { appeal, updatedCheckin, job } = await this.prisma.$transaction(async (tx) => {
      const createdAppeal = await tx.scoreAppeal.create({
        data: {
          userId,
          checkinId: checkin.id,
          reason: payload.reason,
          addedFacts: payload.addedFacts,
          status: appealResult.accepted ? "RESCORED" : "APPEAL_REJECTED",
          originalScore: checkin.aiScore!.totalScore,
          newScore: appealResult.newScore,
          evidence: appealResult.evidence
        }
      });
      const createdJob = await tx.aiJob.create({
        data: {
          userId,
          goalId: checkin.goalId,
          type: CHECKIN_SCORE_APPEAL,
          status: "SUCCEEDED",
          attempts: 1,
          payload: {
            checkinId: checkin.id,
            appealId: createdAppeal.id,
            provider: "mock"
          },
          result: {
            accepted: appealResult.accepted,
            originalScore: checkin.aiScore!.totalScore,
            newScore: appealResult.newScore
          }
        }
      });

      if (appealResult.accepted) {
        await tx.aiScore.update({
          where: { id: checkin.aiScore!.id },
          data: {
            totalScore: appealResult.newScore,
            dimensions: appealResult.dimensions,
            evidence: appealResult.evidence,
            summary: appealResult.summary,
            suggestion: appealResult.suggestion
          }
        });
      }

      const changedCheckin = await tx.checkin.update({
        where: { id: checkin.id },
        data: {
          status: appealResult.accepted ? "RESCORED" : "APPEAL_REJECTED"
        },
        include: {
          aiScore: true
        }
      });

      return {
        appeal: createdAppeal,
        updatedCheckin: changedCheckin,
        job: createdJob
      };
    });

    return {
      appeal: this.serializeScoreAppeal(appeal),
      checkin: this.serializeCheckin(updatedCheckin),
      job: this.serializeAiJob(job)
    };
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

  private taskInclude() {
    return {
      goal: true,
      weeklyPlan: true,
      checkins: {
        orderBy: {
          submittedAt: "desc" as const
        },
        include: {
          aiScore: true
        }
      }
    } as const;
  }

  private async getGoalFilter(userId: string, goalId?: string) {
    if (!goalId) {
      return {
        userId,
        status: {
          in: EXECUTABLE_GOAL_STATUSES
        }
      };
    }

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

    return {
      id: goalId,
      userId
    };
  }

  private parseCompletePayload(input: unknown): CompleteTaskPayload {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const content = this.cleanText(body.content, 2000);
    const investedMinutes = this.parseOptionalInteger(
      body.investedMinutes,
      "投入分钟必须是非负整数"
    );

    if (!content) {
      throw new BadRequestException("请输入完成复盘");
    }

    if (investedMinutes !== undefined && investedMinutes < 0) {
      throw new BadRequestException("投入分钟必须是非负整数");
    }

    return {
      content,
      investedMinutes
    };
  }

  private parseScoreAppealPayload(input: unknown): ScoreAppealPayload {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const reason = this.cleanText(body.reason, 1000);
    const addedFacts = this.cleanText(body.addedFacts, 2000);

    if (reason.length < 8) {
      throw new BadRequestException("请说明申诉原因");
    }

    if (addedFacts.length < 10) {
      throw new BadRequestException("申诉必须补充新增事实或证据");
    }

    return {
      reason,
      addedFacts
    };
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

  private parseYear(value?: string) {
    const year = value ? Number(value) : Number(this.toDateKey(new Date()).slice(0, 4));

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException("年份不正确");
    }

    return year;
  }

  private cleanText(value: unknown, maxLength: number) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().slice(0, maxLength);
  }

  private jsonObject(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private getMockAppealResult(
    payload: ScoreAppealPayload,
    originalScore: number
  ) {
    const factLengthScore = Math.min(8, Math.floor(payload.addedFacts.length / 25));
    const deniesNewFacts = /没有新增|无新增|没有.*证据|无.*证据|没有.*事实|无.*事实/.test(
      payload.addedFacts
    );
    const evidenceBonus = !deniesNewFacts && /证据|截图|链接|数据|记录|产出|附件|commit|照片/i.test(
      payload.addedFacts
    )
      ? 6
      : 0;
    const manipulationPenalty = /必须|威胁|讨好|改成满分|给我高分|不然/i.test(
      `${payload.reason} ${payload.addedFacts}`
    )
      ? 10
      : 0;
    const delta = Math.max(
      0,
      factLengthScore + evidenceBonus - manipulationPenalty - (deniesNewFacts ? 8 : 0)
    );
    const accepted = delta >= 4;
    const newScore = accepted ? Math.min(98, originalScore + delta) : originalScore;
    const dimensions = {
      completion: newScore,
      timeMatch: Math.max(60, newScore - 5),
      evidence: Math.min(98, newScore + (evidenceBonus ? 2 : -4)),
      reflection: Math.max(60, newScore - 3)
    };
    const evidence = {
      source: "mock-appeal",
      originalScore,
      addedFactLength: payload.addedFacts.length,
      deniesNewFacts,
      evidenceBonus,
      manipulationPenalty,
      accepted
    };

    return {
      accepted,
      newScore,
      dimensions,
      evidence,
      summary: accepted
        ? `申诉复评已采纳，新增事实足以支撑评分从 ${originalScore} 调整到 ${newScore}。`
        : `申诉复评未采纳，新增事实不足以改变原评分 ${originalScore}。`,
      suggestion: accepted
        ? "后续复盘请直接写入关键证据，减少申诉成本。"
        : "如需复评，请补充更具体的产出、截图、数据或投入说明。"
    };
  }

  private getActivityHealthScore(input: {
    completionRate: number;
    averageScore: number | null;
    investedMinutes: number;
    plannedMinutes: number;
  }) {
    const scoreComponent = input.averageScore ?? (input.completionRate ? 70 : 0);
    const timeRatio = input.plannedMinutes
      ? Math.min(1.2, input.investedMinutes / input.plannedMinutes)
      : input.investedMinutes > 0
        ? 1
        : 0;
    const timeScore = Math.round(Math.min(100, timeRatio * 100));
    const consistencyScore =
      input.completionRate >= 100
        ? 100
        : input.completionRate >= 50
          ? 72
          : input.completionRate > 0
            ? 45
            : 0;

    return Math.round(
      input.completionRate * 0.35 +
        scoreComponent * 0.3 +
        timeScore * 0.2 +
        consistencyScore * 0.15
    );
  }

  private getActivityLevel(healthScore: number) {
    if (healthScore >= 85) {
      return 4;
    }

    if (healthScore >= 68) {
      return 3;
    }

    if (healthScore >= 45) {
      return 2;
    }

    return healthScore > 0 ? 1 : 0;
  }

  private getDateRange(dateKey: string) {
    const start = new Date(`${dateKey}T00:00:00.000+08:00`);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    return { start, end };
  }

  private getYearRange(year: number) {
    const start = new Date(`${year}-01-01T00:00:00.000+08:00`);
    const end = new Date(`${year + 1}-01-01T00:00:00.000+08:00`);

    return { start, end };
  }

  private toDateKey(date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return `${year}-${month}-${day}`;
  }

  private serializeTask(task: TaskWithGoalAndCheckins) {
    const latestCheckin = task.checkins[0] ?? null;

    return {
      id: task.id,
      goalId: task.goalId,
      goalTitle: task.goal.title,
      weeklyPlanId: task.weeklyPlanId,
      weeklyPlanTitle: task.weeklyPlan?.title ?? null,
      sourceDailyTaskId: task.sourceDailyTaskId,
      deviationEventId: task.deviationEventId,
      taskDate: task.taskDate.toISOString(),
      date: this.toDateKey(task.taskDate),
      title: task.title,
      description: task.description,
      plannedMinutes: task.plannedMinutes,
      estimatedMinutes: task.plannedMinutes ?? 0,
      taskType: task.taskType,
      rescueReason: task.rescueReason,
      rescueTriggerCode: task.rescueTriggerCode,
      rescueRiskLevel: task.rescueRiskLevel,
      status: task.status,
      latestCheckin: latestCheckin ? this.serializeCheckin(latestCheckin) : null
    };
  }

  private serializeActivityTask(task: TaskWithGoalAndCheckins) {
    const latestCheckin = task.checkins[0] ?? null;

    return {
      id: task.id,
      goalId: task.goalId,
      goalTitle: task.goal.title,
      title: task.title,
      description: task.description,
      plannedMinutes: task.plannedMinutes,
      taskType: task.taskType,
      deviationEventId: task.deviationEventId,
      rescueReason: task.rescueReason,
      rescueTriggerCode: task.rescueTriggerCode,
      rescueRiskLevel: task.rescueRiskLevel,
      status: task.status,
      investedMinutes: latestCheckin?.investedMinutes ?? null,
      aiScore: latestCheckin?.aiScore?.totalScore ?? null,
      reflection: latestCheckin?.content ?? null,
      completedAt: latestCheckin?.submittedAt.toISOString() ?? null
    };
  }

  private serializeCheckin(checkin: Checkin & { aiScore: AiScore | null }) {
    return {
      id: checkin.id,
      dailyTaskId: checkin.dailyTaskId,
      content: checkin.content,
      investedMinutes: checkin.investedMinutes,
      submittedAt: checkin.submittedAt.toISOString(),
      aiScore: checkin.aiScore
        ? {
            totalScore: checkin.aiScore.totalScore,
            dimensions: checkin.aiScore.dimensions,
            evidence: checkin.aiScore.evidence,
            summary: checkin.aiScore.summary,
            suggestion: checkin.aiScore.suggestion
          }
        : null
    };
  }

  private serializeScoreAppeal(appeal: {
    id: string;
    userId: string;
    checkinId: string;
    reason: string;
    addedFacts: string;
    status: string;
    originalScore: number;
    newScore: number | null;
    evidence: unknown;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: appeal.id,
      userId: appeal.userId,
      checkinId: appeal.checkinId,
      reason: appeal.reason,
      addedFacts: appeal.addedFacts,
      status: appeal.status,
      originalScore: appeal.originalScore,
      newScore: appeal.newScore,
      evidence: appeal.evidence,
      createdAt: appeal.createdAt.toISOString(),
      updatedAt: appeal.updatedAt.toISOString()
    };
  }

  private serializeTimelineCheckinItem(checkin: TimelineCheckin) {
    const task = checkin.dailyTask;
    const submittedAt = checkin.submittedAt.toISOString();

    return {
      id: checkin.id,
      kind: "CHECKIN" as const,
      chainStage:
        task?.taskType === RESCUE_TASK_TYPE
          ? ("RESCUE_COMPLETED" as const)
          : ("CHECKIN" as const),
      timelineAt: submittedAt,
      date: this.toDateKey(checkin.submittedAt),
      submittedAt,
      detectedAt: null,
      goalId: checkin.goalId,
      goalTitle: checkin.goal.title,
      dailyTaskId: checkin.dailyTaskId,
      sourceDailyTaskId: task?.sourceDailyTaskId ?? null,
      deviationEventId: task?.deviationEventId ?? null,
      taskTitle: task?.title ?? "未关联任务复盘",
      taskDescription: task?.description ?? null,
      weeklyPlanTitle: task?.weeklyPlan?.title ?? null,
      plannedMinutes: task?.plannedMinutes ?? null,
      taskType: task?.taskType ?? "CHECKIN",
      isRescueTask: task?.taskType === RESCUE_TASK_TYPE,
      rescueReason: task?.rescueReason ?? null,
      rescueTriggerCode: task?.rescueTriggerCode ?? null,
      rescueRiskLevel: task?.rescueRiskLevel ?? null,
      deviationReasons: [],
      deviationMetrics: null,
      sourceTask: null,
      rescueTasks: [],
      investedMinutes: checkin.investedMinutes,
      checkin: this.serializeCheckin(checkin),
      aiScore: checkin.aiScore
        ? {
            totalScore: checkin.aiScore.totalScore,
            dimensions: checkin.aiScore.dimensions,
            evidence: checkin.aiScore.evidence,
            summary: checkin.aiScore.summary,
            suggestion: checkin.aiScore.suggestion
          }
        : null
    };
  }

  private serializeTimelineDeviationItem(
    event: TimelineDeviationEvent,
    sourceTask?: TimelineSourceTask
  ) {
    const detectedAt = event.detectedAt.toISOString();
    const rescueTasks = event.rescueTasks.map((task) =>
      this.serializeTimelineRescueTask(task)
    );
    const completedRescueTask = rescueTasks.find((task) => task.latestCheckin?.aiScore);
    const latestScore = completedRescueTask?.latestCheckin?.aiScore ?? null;
    const title = event.primaryReasonLabel
      ? `偏差触发：${event.primaryReasonLabel}`
      : "偏差触发";

    return {
      id: `deviation-${event.id}`,
      kind: "DEVIATION" as const,
      chainStage: "DEVIATION_CHAIN" as const,
      timelineAt: detectedAt,
      date: this.toDateKey(event.detectedAt),
      submittedAt: detectedAt,
      detectedAt,
      goalId: event.goalId,
      goalTitle: event.goal.title,
      dailyTaskId: null,
      sourceDailyTaskId: event.sourceDailyTaskId,
      deviationEventId: event.id,
      taskTitle: title,
      taskDescription: event.primaryReasonDetail,
      weeklyPlanTitle: null,
      plannedMinutes: null,
      taskType: "DEVIATION",
      isRescueTask: false,
      rescueReason: event.primaryReasonDetail,
      rescueTriggerCode: event.primaryReasonCode,
      rescueRiskLevel: event.riskLevel,
      deviationReasons: this.normalizeDeviationReasons(event.reasons),
      deviationMetrics: this.normalizeDeviationMetrics(event.metrics),
      sourceTask: sourceTask
        ? {
            id: sourceTask.id,
            title: sourceTask.title,
            description: sourceTask.description,
            weeklyPlanTitle: sourceTask.weeklyPlan?.title ?? null,
            plannedMinutes: sourceTask.plannedMinutes,
            status: sourceTask.status
          }
        : null,
      rescueTasks,
      investedMinutes: null,
      checkin: null,
      aiScore: latestScore
    };
  }

  private serializeTimelineRescueTask(task: TimelineRescueTask) {
    const latestCheckin = task.checkins[0] ?? null;

    return {
      id: task.id,
      dailyTaskId: task.id,
      deviationEventId: task.deviationEventId,
      sourceDailyTaskId: task.sourceDailyTaskId,
      title: task.title,
      description: task.description,
      weeklyPlanTitle: task.weeklyPlan?.title ?? null,
      plannedMinutes: task.plannedMinutes,
      status: task.status,
      taskType: task.taskType,
      rescueReason: task.rescueReason,
      rescueTriggerCode: task.rescueTriggerCode,
      rescueRiskLevel: task.rescueRiskLevel,
      createdAt: task.createdAt.toISOString(),
      completedAt: latestCheckin?.submittedAt.toISOString() ?? null,
      latestCheckin: latestCheckin ? this.serializeCheckin(latestCheckin) : null
    };
  }

  private normalizeDeviationReasons(value: unknown): TimelineDeviationReason[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }

      const record = item as Record<string, unknown>;

      return [
        {
          code: typeof record.code === "string" ? record.code : "",
          level: typeof record.level === "string" ? record.level : "",
          label: typeof record.label === "string" ? record.label : "",
          detail: typeof record.detail === "string" ? record.detail : ""
        }
      ];
    });
  }

  private normalizeDeviationMetrics(value: unknown): TimelineDeviationMetrics | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;

    return {
      averageScore:
        typeof record.averageScore === "number" ? record.averageScore : null,
      recentInvestedMinutes: this.getNumberMetric(record.recentInvestedMinutes),
      expectedRecentMinutes: this.getNumberMetric(record.expectedRecentMinutes),
      streakDays: this.getNumberMetric(record.streakDays),
      overdueTaskCount: this.getNumberMetric(record.overdueTaskCount),
      incompleteTodayTaskCount: this.getNumberMetric(record.incompleteTodayTaskCount)
    };
  }

  private getNumberMetric(value: unknown) {
    return typeof value === "number" ? value : 0;
  }

  private serializeAiJob(job: {
    id: string;
    goalId: string | null;
    type: string;
    status: string;
    attempts: number;
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: job.id,
      goalId: job.goalId,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    };
  }
}

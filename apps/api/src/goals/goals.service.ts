import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AiScore,
  Checkin,
  DailyTask,
  DeviationEvent,
  Goal,
  GoalCategory,
  Prisma
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface CreateGoalPayload {
  title: string;
  description: string;
  category: GoalCategory;
  startDate: Date;
  endDate: Date;
  dailyTimeBudgetMinutes?: number;
  toleranceDaysAllowed: number;
  currentBaseline?: string;
  constraints?: string;
  finalReward?: string;
}

const CATEGORY_MAP: Record<string, GoalCategory> = {
  study: "STUDY",
  career: "CAREER",
  fitness: "FITNESS",
  habit: "HABIT",
  custom: "CUSTOM"
};

const DONE_STATUS = "DONE";
const RESCUE_TASK_TYPE = "RESCUE";
const PENDING_STATUS = "PENDING";

type HealthTask = DailyTask & {
  checkins: Array<Checkin & { aiScore: AiScore | null }>;
};

type DeviationRiskLevel = "stable" | "warning" | "danger";

type DeviationReasonCode =
  | "LOW_SCORE"
  | "LOW_INVESTMENT"
  | "BROKEN_STREAK"
  | "TASK_DELAY";

interface DeviationReason {
  code: DeviationReasonCode;
  level: Exclude<DeviationRiskLevel, "stable">;
  label: string;
  detail: string;
}

interface DeviationSignal {
  eventId?: string | null;
  detectedAt?: string | null;
  riskLevel: DeviationRiskLevel;
  reasons: DeviationReason[];
  metrics: {
    averageScore: number | null;
    recentInvestedMinutes: number;
    expectedRecentMinutes: number;
    streakDays: number;
    overdueTaskCount: number;
    incompleteTodayTaskCount: number;
  };
}

@Injectable()
export class GoalsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createGoal(userId: string, input: unknown) {
    const payload = this.parseCreateGoalPayload(input);
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        title: payload.title,
        description: payload.description,
        category: payload.category,
        status: "DRAFT",
        startDate: payload.startDate,
        endDate: payload.endDate,
        dailyTimeBudgetMinutes: payload.dailyTimeBudgetMinutes,
        toleranceDaysAllowed: payload.toleranceDaysAllowed,
        currentBaseline: payload.currentBaseline,
        constraints: payload.constraints,
        finalReward: payload.finalReward
      }
    });

    return {
      goal: this.serializeGoal(goal)
    };
  }

  async listGoals(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    return {
      goals: goals.map((goal) => this.serializeGoal(goal))
    };
  }

  async getGoalById(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    return {
      goal: this.serializeGoal(goal)
    };
  }

  async getGoalHealth(userId: string, id: string) {
    const context = await this.getGoalHealthContext(userId, id);
    const {
      goal,
      todayTasks,
      weekTasks,
      allTasks,
      recentCheckins,
      todayStart,
      todayEnd,
      recentStart,
      recentEnd
    } = context;
    const todayCompletionRate = this.getCompletionRate(todayTasks);
    const weekCompletionRate = this.getCompletionRate(weekTasks);
    const streakDays = this.getStreakDays(allTasks, todayStart);
    const averageScore = this.getAverageScore(recentCheckins);
    const recentInvestedMinutes = this.getRecentInvestedMinutes(recentCheckins);
    const toleranceRemaining = Math.max(
      0,
      goal.toleranceDaysAllowed - goal.toleranceDaysUsed
    );
    const deviation = this.buildDeviationSignal({
      goal,
      todayTasks,
      allTasks,
      recentCheckins,
      todayStart,
      recentStart,
      recentEnd,
      averageScore,
      recentInvestedMinutes,
      streakDays
    });
    const sourceTask = this.findRescueSourceTask(todayTasks, allTasks, todayStart);
    const deviationEvent = await this.persistDeviationEvent({
      goal,
      deviation,
      sourceTask,
      todayStart,
      todayEnd
    });
    const risks = this.buildHealthRisks({
      todayCompletionRate,
      weekCompletionRate,
      streakDays,
      averageScore,
      toleranceRemaining,
      deviation
    });
    const healthScore = this.getHealthScore({
      todayCompletionRate,
      weekCompletionRate,
      streakDays,
      averageScore,
      toleranceRemaining,
      riskCount: risks.length
    });

    return {
      goalId: goal.id,
      goalTitle: goal.title,
      status: goal.status,
      healthScore,
      todayCompletionRate,
      weekCompletionRate,
      streakDays,
      toleranceRemaining,
      averageScore,
      recentInvestedMinutes,
      risks,
      deviation: this.serializeDeviationSignal(deviation, deviationEvent)
    };
  }

  async generateRescueTask(userId: string, id: string) {
    const context = await this.getGoalHealthContext(userId, id);
    const {
      goal,
      todayTasks,
      allTasks,
      recentCheckins,
      todayStart,
      recentStart,
      recentEnd
    } = context;

    if (!["ACTIVE", "AT_RISK", "REPLANNING"].includes(goal.status)) {
      throw new BadRequestException("当前目标状态不能生成救援任务");
    }

    const averageScore = this.getAverageScore(recentCheckins);
    const recentInvestedMinutes = this.getRecentInvestedMinutes(recentCheckins);
    const streakDays = this.getStreakDays(allTasks, todayStart);
    const deviation = this.buildDeviationSignal({
      goal,
      todayTasks,
      allTasks,
      recentCheckins,
      todayStart,
      recentStart,
      recentEnd,
      averageScore,
      recentInvestedMinutes,
      streakDays
    });
    const sourceTask = this.findRescueSourceTask(todayTasks, allTasks, todayStart);
    const existingRescueTask = await this.prisma.dailyTask.findFirst({
      where: {
        goalId: goal.id,
        taskType: RESCUE_TASK_TYPE,
        status: PENDING_STATUS,
        taskDate: {
          gte: todayStart,
          lt: context.todayEnd
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    const existingDeviationEvent = existingRescueTask?.deviationEventId
      ? await this.prisma.deviationEvent.findUnique({
          where: { id: existingRescueTask.deviationEventId }
        })
      : null;
    const deviationEvent =
      existingDeviationEvent ??
      (await this.persistDeviationEvent({
        goal,
        deviation,
        sourceTask,
        todayStart,
        todayEnd: context.todayEnd
      }));
    const rescueTaskDraft = this.buildMockRescueTask(goal, deviation);
    const rescueTask = existingRescueTask
      ? existingRescueTask.deviationEventId || !deviationEvent
        ? existingRescueTask
        : await this.prisma.dailyTask.update({
            where: { id: existingRescueTask.id },
            data: { deviationEventId: deviationEvent.id }
          })
      : await this.prisma.dailyTask.create({
        data: {
          goalId: goal.id,
          sourceDailyTaskId: sourceTask?.id,
          deviationEventId: deviationEvent?.id,
          taskDate: todayStart,
          title: rescueTaskDraft.title,
          description: rescueTaskDraft.description,
          plannedMinutes: rescueTaskDraft.estimatedMinutes,
          taskType: RESCUE_TASK_TYPE,
          rescueReason: rescueTaskDraft.reason,
          rescueTriggerCode: rescueTaskDraft.triggerCode,
          rescueRiskLevel: deviation.riskLevel,
          status: PENDING_STATUS
        }
      });

    return {
      goalId: goal.id,
      goalTitle: goal.title,
      deviation: this.serializeDeviationSignal(deviation, deviationEvent),
      rescueTask: this.serializeRescueTask(goal, rescueTask)
    };
  }

  private async getGoalHealthContext(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    const todayKey = this.toDateKey(new Date());
    const { start: todayStart, end: todayEnd } = this.getDateRange(todayKey);
    const { start: weekStart, end: weekEnd } = this.getWeekRange(todayStart);
    const { start: recentStart, end: recentEnd } = this.getRecentRange(todayStart, 7);
    const [todayTasks, weekTasks, allTasks, recentCheckins] = await Promise.all([
      this.prisma.dailyTask.findMany({
        where: {
          goalId: goal.id,
          taskDate: {
            gte: todayStart,
            lt: todayEnd
          }
        },
        include: this.healthTaskInclude()
      }),
      this.prisma.dailyTask.findMany({
        where: {
          goalId: goal.id,
          taskDate: {
            gte: weekStart,
            lt: weekEnd
          }
        },
        include: this.healthTaskInclude()
      }),
      this.prisma.dailyTask.findMany({
        where: {
          goalId: goal.id,
          taskDate: {
            lte: todayEnd
          }
        },
        orderBy: {
          taskDate: "asc"
        },
        include: this.healthTaskInclude()
      }),
      this.prisma.checkin.findMany({
        where: {
          goalId: goal.id,
          submittedAt: {
            gte: recentStart,
            lt: recentEnd
          }
        },
        orderBy: {
          submittedAt: "asc"
        },
        include: {
          aiScore: true
        }
      })
    ]);

    return {
      goal,
      todayTasks,
      weekTasks,
      allTasks,
      recentCheckins,
      todayStart,
      todayEnd,
      recentStart,
      recentEnd
    };
  }

  private parseCreateGoalPayload(input: unknown): CreateGoalPayload {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const description = this.cleanText(body.description, 2000);
    const title = this.cleanText(body.title, 80) || this.deriveTitle(description);
    const category = this.parseCategory(body.category);
    const startDate = this.parseDate(body.startDate, "开始日期不正确");
    const endDate = this.parseDate(body.endDate, "结束日期不正确");
    const dailyTimeBudgetMinutes = this.parseOptionalInteger(
      body.dailyTimeBudgetMinutes,
      "每日投入时间必须是正整数"
    );
    const toleranceDaysAllowed =
      this.parseOptionalInteger(body.toleranceDaysAllowed, "容错次数必须是非负整数") ??
      0;

    if (!description) {
      throw new BadRequestException("请输入目标描述");
    }

    if (!title) {
      throw new BadRequestException("请输入目标标题");
    }

    if (endDate < startDate) {
      throw new BadRequestException("结束日期不能早于开始日期");
    }

    if (dailyTimeBudgetMinutes !== undefined && dailyTimeBudgetMinutes <= 0) {
      throw new BadRequestException("每日投入时间必须大于 0");
    }

    if (toleranceDaysAllowed < 0 || toleranceDaysAllowed > 366) {
      throw new BadRequestException("容错次数范围应为 0 到 366");
    }

    return {
      title,
      description,
      category,
      startDate,
      endDate,
      dailyTimeBudgetMinutes,
      toleranceDaysAllowed,
      currentBaseline: this.cleanText(body.currentBaseline, 1000) || undefined,
      constraints: this.cleanText(body.constraints, 1000) || undefined,
      finalReward: this.cleanText(body.finalReward, 1000) || undefined
    };
  }

  private cleanText(value: unknown, maxLength: number) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().slice(0, maxLength);
  }

  private deriveTitle(description: string) {
    return description.replace(/\s+/g, " ").slice(0, 60);
  }

  private parseCategory(value: unknown) {
    if (typeof value !== "string") {
      return "CUSTOM";
    }

    return CATEGORY_MAP[value.toLowerCase()] ?? "CUSTOM";
  }

  private parseDate(value: unknown, errorMessage: string) {
    if (typeof value !== "string" || !value) {
      throw new BadRequestException(errorMessage);
    }

    const date = new Date(`${value}T00:00:00.000+08:00`);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(errorMessage);
    }

    return date;
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

  private healthTaskInclude() {
    return {
      checkins: {
        include: {
          aiScore: true
        }
      }
    } as const;
  }

  private getCompletionRate(tasks: HealthTask[]) {
    if (!tasks.length) {
      return 0;
    }

    const completedCount = tasks.filter((task) => this.isTaskCompleted(task)).length;

    return Math.round((completedCount / tasks.length) * 100);
  }

  private getStreakDays(tasks: HealthTask[], todayStart: Date) {
    const tasksByDate = new Map<string, HealthTask[]>();

    for (const task of tasks) {
      const dateKey = this.toDateKey(task.taskDate);
      const dateTasks = tasksByDate.get(dateKey) ?? [];
      dateTasks.push(task);
      tasksByDate.set(dateKey, dateTasks);
    }

    let streak = 0;

    for (let offset = 0; offset < 366; offset += 1) {
      const date = new Date(todayStart);
      date.setUTCDate(todayStart.getUTCDate() - offset);
      const dateTasks = tasksByDate.get(this.toDateKey(date));

      if (!dateTasks?.some((task) => this.isTaskCompleted(task))) {
        break;
      }

      streak += 1;
    }

    return streak;
  }

  private isTaskCompleted(task: HealthTask) {
    return task.status === DONE_STATUS || task.checkins.some((checkin) => checkin.aiScore);
  }

  private findRescueSourceTask(
    todayTasks: HealthTask[],
    allTasks: HealthTask[],
    todayStart: Date
  ) {
    return (
      todayTasks.find((task) => !this.isTaskCompleted(task)) ??
      allTasks
        .filter((task) => task.taskDate < todayStart && !this.isTaskCompleted(task))
        .sort((left, right) => right.taskDate.getTime() - left.taskDate.getTime())[0] ??
      null
    );
  }

  private async persistDeviationEvent(input: {
    goal: Goal;
    deviation: DeviationSignal;
    sourceTask: HealthTask | null;
    todayStart: Date;
    todayEnd: Date;
  }) {
    if (input.deviation.riskLevel === "stable" || !input.deviation.reasons.length) {
      return null;
    }

    const primaryReason = input.deviation.reasons[0];
    const existingEvent = await this.prisma.deviationEvent.findFirst({
      where: {
        goalId: input.goal.id,
        primaryReasonCode: primaryReason.code,
        detectedAt: {
          gte: input.todayStart,
          lt: input.todayEnd
        }
      },
      orderBy: {
        detectedAt: "desc"
      }
    });
    const data = {
      sourceDailyTaskId:
        input.sourceTask?.id ?? existingEvent?.sourceDailyTaskId ?? null,
      riskLevel: input.deviation.riskLevel,
      primaryReasonCode: primaryReason.code,
      primaryReasonLabel: primaryReason.label,
      primaryReasonDetail: primaryReason.detail,
      reasons: this.toJson(input.deviation.reasons),
      metrics: this.toJson(input.deviation.metrics),
      detectedAt: new Date()
    };

    if (existingEvent) {
      return this.prisma.deviationEvent.update({
        where: { id: existingEvent.id },
        data
      });
    }

    return this.prisma.deviationEvent.create({
      data: {
        goalId: input.goal.id,
        ...data
      }
    });
  }

  private toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private getAverageScore(checkins: Array<Checkin & { aiScore: AiScore | null }>) {
    const scores = checkins
      .map((checkin) => checkin.aiScore?.totalScore)
      .filter((score): score is number => typeof score === "number");

    if (!scores.length) {
      return null;
    }

    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }

  private getRecentInvestedMinutes(
    checkins: Array<Checkin & { aiScore: AiScore | null }>
  ) {
    return checkins.reduce(
      (sum, checkin) => sum + (checkin.investedMinutes ?? 0),
      0
    );
  }

  private buildDeviationSignal(input: {
    goal: Goal;
    todayTasks: HealthTask[];
    allTasks: HealthTask[];
    recentCheckins: Array<Checkin & { aiScore: AiScore | null }>;
    todayStart: Date;
    recentStart: Date;
    recentEnd: Date;
    averageScore: number | null;
    recentInvestedMinutes: number;
    streakDays: number;
  }): DeviationSignal {
    const recentTasks = input.allTasks.filter(
      (task) => task.taskDate >= input.recentStart && task.taskDate < input.recentEnd
    );
    const plannedRecentMinutes = recentTasks.reduce(
      (sum, task) => sum + (task.plannedMinutes ?? 0),
      0
    );
    const expectedRecentMinutes =
      input.goal.dailyTimeBudgetMinutes !== null
        ? input.goal.dailyTimeBudgetMinutes * 7
        : plannedRecentMinutes;
    const overdueTaskCount = input.allTasks.filter(
      (task) => task.taskDate < input.todayStart && !this.isTaskCompleted(task)
    ).length;
    const incompleteTodayTaskCount = input.todayTasks.filter(
      (task) => !this.isTaskCompleted(task)
    ).length;
    const reasons: DeviationReason[] = [];

    if (input.averageScore !== null && input.averageScore < 70) {
      reasons.push({
        code: "LOW_SCORE",
        level: input.averageScore < 60 ? "danger" : "warning",
        label: "低评分",
        detail: `最近平均 AI 评分 ${input.averageScore}，低于 70 分稳定线。`
      });
    }

    if (
      expectedRecentMinutes > 0 &&
      input.recentInvestedMinutes < expectedRecentMinutes * 0.8
    ) {
      const percent = Math.round(
        (input.recentInvestedMinutes / expectedRecentMinutes) * 100
      );

      reasons.push({
        code: "LOW_INVESTMENT",
        level: percent < 50 ? "danger" : "warning",
        label: "低投入",
        detail: `近 7 天投入 ${input.recentInvestedMinutes} 分钟，约为预期 ${expectedRecentMinutes} 分钟的 ${percent}%。`
      });
    }

    if (
      input.streakDays === 0 &&
      (input.todayTasks.length > 0 || input.recentCheckins.length > 0)
    ) {
      reasons.push({
        code: "BROKEN_STREAK",
        level: incompleteTodayTaskCount > 0 ? "danger" : "warning",
        label: "断签",
        detail: incompleteTodayTaskCount
          ? `今天还有 ${incompleteTodayTaskCount} 个任务未完成，连续完成已中断。`
          : "最近连续完成天数为 0，需要先恢复最小执行节奏。"
      });
    }

    if (overdueTaskCount > 0) {
      reasons.push({
        code: "TASK_DELAY",
        level: overdueTaskCount >= 3 ? "danger" : "warning",
        label: "任务延期",
        detail: `已有 ${overdueTaskCount} 个历史任务未完成。`
      });
    }

    return {
      riskLevel: reasons.some((reason) => reason.level === "danger")
        ? "danger"
        : reasons.length
          ? "warning"
          : "stable",
      reasons,
      metrics: {
        averageScore: input.averageScore,
        recentInvestedMinutes: input.recentInvestedMinutes,
        expectedRecentMinutes,
        streakDays: input.streakDays,
        overdueTaskCount,
        incompleteTodayTaskCount
      }
    };
  }

  private buildMockRescueTask(goal: Goal, deviation: DeviationSignal) {
    const primaryReason = deviation.reasons[0];
    const fallbackMinutes = Math.min(
      25,
      Math.max(10, Math.round((goal.dailyTimeBudgetMinutes ?? 30) / 2))
    );

    if (!primaryReason) {
      return {
        title: "完成一次轻量巩固任务",
        description: `围绕「${goal.title}」选择一个最小可交付动作，完成后写下 2 句复盘。`,
        estimatedMinutes: fallbackMinutes,
        reason: "当前节奏稳定，用低压力任务保持连续性。",
        triggerCode: null,
        createdAt: new Date().toISOString()
      };
    }

    const templates: Record<
      DeviationReasonCode,
      { title: string; description: string; estimatedMinutes: number }
    > = {
      LOW_SCORE: {
        title: "补一条可验证成果",
        description:
          "回到最近一次低分任务，补充一个截图、笔记、数据或具体产出，并用 3 句话说明它如何推进目标。",
        estimatedMinutes: Math.min(20, fallbackMinutes)
      },
      LOW_INVESTMENT: {
        title: "做 15 分钟最小推进",
        description:
          "只选一个不会卡住的小动作：阅读一页、整理一个知识点、快走一小段或完成一个微练习，到点即停。",
        estimatedMinutes: Math.min(15, fallbackMinutes)
      },
      BROKEN_STREAK: {
        title: "恢复连续性的低压打卡",
        description:
          "完成一个 10 分钟内能结束的目标相关动作，并提交一句完成事实，先把今天的执行链路接回来。",
        estimatedMinutes: 10
      },
      TASK_DELAY: {
        title: "清理一个延期任务的最小版本",
        description:
          "从延期任务里选最容易的一项，只完成原计划的第一步，并记录剩余部分明天如何继续。",
        estimatedMinutes: Math.min(20, fallbackMinutes)
      }
    };
    const template = templates[primaryReason.code];

    return {
      ...template,
      reason: primaryReason.detail,
      triggerCode: primaryReason.code,
      createdAt: new Date().toISOString()
    };
  }

  private buildHealthRisks(input: {
    todayCompletionRate: number;
    weekCompletionRate: number;
    streakDays: number;
    averageScore: number | null;
    toleranceRemaining: number;
    deviation: DeviationSignal;
  }) {
    const risks: Array<{
      level: "warning" | "danger";
      title: string;
      detail: string;
      suggestion: string;
    }> = [];

    if (input.weekCompletionRate < 60) {
      risks.push({
        level: "danger",
        title: "本周完成率偏低",
        detail: `当前本周完成率 ${input.weekCompletionRate}%。`,
        suggestion: "今晚只完成最小任务，先恢复执行节奏。"
      });
    }

    if (input.streakDays === 0) {
      risks.push({
        level: "warning",
        title: "连续完成中断",
        detail: "最近连续完成天数为 0。",
        suggestion: "今天优先完成一个低压力任务，避免继续断档。"
      });
    }

    if (input.averageScore !== null && input.averageScore < 70) {
      risks.push({
        level: "warning",
        title: "任务质量偏低",
        detail: `最近平均 AI 评分 ${input.averageScore}。`,
        suggestion: "复盘时补充可验证成果，减少只写过程描述。"
      });
    }

    if (input.toleranceRemaining <= 1) {
      risks.push({
        level: "danger",
        title: "容错余额不足",
        detail: `剩余容错 ${input.toleranceRemaining} 次。`,
        suggestion: "未来 3 天降低任务规模，优先保证不断签。"
      });
    }

    for (const reason of input.deviation.reasons) {
      if (reason.code === "LOW_INVESTMENT") {
        risks.push({
          level: reason.level,
          title: "近 7 天投入不足",
          detail: reason.detail,
          suggestion: "先生成一个 10-15 分钟救援任务，恢复行动惯性。"
        });
      }

      if (reason.code === "TASK_DELAY") {
        risks.push({
          level: reason.level,
          title: "存在延期任务",
          detail: reason.detail,
          suggestion: "今天只处理一个延期任务的最小版本，避免积压继续扩大。"
        });
      }
    }

    return risks;
  }

  private getHealthScore(input: {
    todayCompletionRate: number;
    weekCompletionRate: number;
    streakDays: number;
    averageScore: number | null;
    toleranceRemaining: number;
    riskCount: number;
  }) {
    const score =
      20 +
      input.todayCompletionRate * 0.22 +
      input.weekCompletionRate * 0.28 +
      Math.min(15, input.streakDays * 3) +
      (input.averageScore ?? 70) * 0.25 +
      Math.min(10, input.toleranceRemaining * 2) -
      input.riskCount * 6;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private getDateRange(dateKey: string) {
    const start = new Date(`${dateKey}T00:00:00.000+08:00`);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    return { start, end };
  }

  private getWeekRange(todayStart: Date) {
    const weekStart = new Date(todayStart);
    const day = weekStart.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    weekStart.setUTCDate(weekStart.getUTCDate() + mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

    return { start: weekStart, end: weekEnd };
  }

  private getRecentRange(todayStart: Date, days: number) {
    const start = new Date(todayStart);
    start.setUTCDate(todayStart.getUTCDate() - (days - 1));
    const end = new Date(todayStart);
    end.setUTCDate(todayStart.getUTCDate() + 1);

    return { start, end };
  }

  private toDateKey(date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return `${year}-${month}-${day}`;
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

  private serializeDeviationSignal(
    deviation: DeviationSignal,
    event: DeviationEvent | null
  ) {
    return {
      ...deviation,
      eventId: event?.id ?? null,
      detectedAt: event?.detectedAt.toISOString() ?? null
    };
  }

  private serializeRescueTask(goal: Goal, task: DailyTask) {
    return {
      id: task.id,
      goalId: task.goalId,
      goalTitle: goal.title,
      weeklyPlanId: task.weeklyPlanId,
      weeklyPlanTitle: null,
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
      reason: task.rescueReason ?? "系统生成的低压力补救动作。",
      triggerCode: task.rescueTriggerCode,
      riskLevel: task.rescueRiskLevel,
      status: task.status,
      latestCheckin: null,
      createdAt: task.createdAt.toISOString()
    };
  }
}

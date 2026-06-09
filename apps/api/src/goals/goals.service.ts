import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { AiScore, Checkin, DailyTask, Goal, GoalCategory } from "@prisma/client";
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

type HealthTask = DailyTask & {
  checkins: Array<Checkin & { aiScore: AiScore | null }>;
};

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
    const todayCompletionRate = this.getCompletionRate(todayTasks);
    const weekCompletionRate = this.getCompletionRate(weekTasks);
    const streakDays = this.getStreakDays(allTasks, todayStart);
    const averageScore = this.getAverageScore(recentCheckins);
    const recentInvestedMinutes = this.getRecentInvestedMinutes(recentCheckins);
    const toleranceRemaining = Math.max(
      0,
      goal.toleranceDaysAllowed - goal.toleranceDaysUsed
    );
    const risks = this.buildHealthRisks({
      todayCompletionRate,
      weekCompletionRate,
      streakDays,
      averageScore,
      toleranceRemaining
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
      risks
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

  private buildHealthRisks(input: {
    todayCompletionRate: number;
    weekCompletionRate: number;
    streakDays: number;
    averageScore: number | null;
    toleranceRemaining: number;
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
}

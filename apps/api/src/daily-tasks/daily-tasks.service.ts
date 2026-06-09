import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { AiScore, Checkin, DailyTask, Goal, GoalStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type TaskWithGoalAndCheckins = DailyTask & {
  goal: Goal;
  checkins: Array<Checkin & { aiScore: AiScore | null }>;
};

interface CompleteTaskPayload {
  content: string;
  investedMinutes?: number;
}

const EXECUTABLE_GOAL_STATUSES: GoalStatus[] = [
  "ACTIVE",
  "AT_RISK",
  "REPLANNING"
];
const DONE_STATUS = "DONE";
const TIMEZONE = "Asia/Shanghai";

@Injectable()
export class DailyTasksService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
        completedTaskCount: number;
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
          completedTaskCount: 0,
          investedMinutes: 0,
          scoreTotal: 0,
          scoreCount: 0,
          tasks: []
      };
      const completedCheckins = task.checkins.filter((checkin) => checkin.aiScore);
      const isCompleted = task.status === DONE_STATUS || completedCheckins.length > 0;

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
      days: Array.from(days.values()).map((day) => ({
        date: day.date,
        level: Math.min(4, day.completedTaskCount),
        completedTaskCount: day.completedTaskCount,
        investedMinutes: day.investedMinutes,
        averageScore: day.scoreCount
          ? Math.round(day.scoreTotal / day.scoreCount)
          : null,
        tasks: day.tasks
      }))
    };
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
    const totalScore = this.getMockScore(payload.content, investedMinutes);
    const completedTask = await this.prisma.$transaction(async (tx) => {
      await tx.dailyTask.update({
        where: { id: task.id },
        data: { status: DONE_STATUS }
      });

      await tx.checkin.create({
        data: {
          userId,
          goalId: task.goalId,
          dailyTaskId: task.id,
          status: "SCORED",
          content: payload.content,
          investedMinutes,
          aiScore: {
            create: {
              totalScore,
              dimensions: {
                completion: totalScore,
                focus: Math.max(60, totalScore - 4),
                evidence: Math.max(60, totalScore - 8)
              },
              evidence: {
                source: "mock",
                dailyTaskId: task.id
              },
              summary: "已记录完成情况，并生成 mock 评分。",
              suggestion: "继续保持当天节奏，明天优先推进下一项计划任务。"
            }
          }
        }
      });

      return tx.dailyTask.findUniqueOrThrow({
        where: { id: task.id },
        include: this.taskInclude()
      });
    });

    return {
      task: this.serializeTask(completedTask),
      checkin: this.serializeCheckin(completedTask.checkins[0]!)
    };
  }

  private taskInclude() {
    return {
      goal: true,
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

  private getMockScore(content: string, investedMinutes: number) {
    const contentScore = Math.min(20, Math.floor(content.length / 6));
    const timeScore = Math.min(20, Math.floor(investedMinutes / 5));

    return Math.max(60, Math.min(98, 62 + contentScore + timeScore));
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
      taskDate: task.taskDate.toISOString(),
      date: this.toDateKey(task.taskDate),
      title: task.title,
      description: task.description,
      plannedMinutes: task.plannedMinutes,
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
            summary: checkin.aiScore.summary,
            suggestion: checkin.aiScore.suggestion
          }
        : null
    };
  }
}

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Goal, GoalCategory } from "@prisma/client";
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

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

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


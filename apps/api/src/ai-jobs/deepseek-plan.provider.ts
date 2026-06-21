import { Inject, Injectable } from "@nestjs/common";
import { Goal } from "@prisma/client";
import {
  GeneratedDailyTask,
  GeneratedGoalPlan,
  GeneratedMilestone,
  GeneratedWeeklyPlan
} from "./mock-plan.provider";
import { PlanProvider } from "./plan-provider";
import { AiCallService } from "../ai/ai-call.service";
import { AiCallContext } from "../ai/ai-call.types";
import { AI_PROMPTS } from "../ai/ai-prompts";

interface DeepSeekPlanResponse {
  summary?: unknown;
  milestones?: unknown;
  weeklyPlans?: unknown;
}

@Injectable()
export class DeepSeekPlanProvider implements PlanProvider {
  readonly name = "deepseek";

  constructor(@Inject(AiCallService) private readonly ai: AiCallService) {}

  isConfigured() {
    return this.ai.isConfigured();
  }

  async generate(goal: Goal, context?: AiCallContext): Promise<GeneratedGoalPlan> {
    return this.ai.completeJson({
      capability: "PLAN_GENERATION",
      promptVersion: AI_PROMPTS.plan.version,
      systemPrompt: AI_PROMPTS.plan.system,
      context: context ?? { userId: goal.userId, goalId: goal.id },
      input: {
        title: goal.title, description: goal.description, category: goal.category,
        startDate: goal.startDate.toISOString(), endDate: goal.endDate.toISOString(),
        dailyTimeBudgetMinutes: goal.dailyTimeBudgetMinutes, examName: goal.examName,
        targetScore: goal.targetScore, currentScore: goal.currentScore,
        examDate: goal.examDate?.toISOString(), subjects: goal.subjects,
        materials: goal.materials, chapters: goal.chapters, weaknesses: goal.weaknesses,
        studyDaysPerWeek: goal.studyDaysPerWeek, dailyStudyMinutes: goal.dailyStudyMinutes,
        mockExamFrequency: goal.mockExamFrequency, currentBaseline: goal.currentBaseline,
        constraints: goal.constraints, finalReward: goal.finalReward
      },
      validate: (value) => this.parsePlanValue(value)
    });
  }

  private parsePlanValue(value: unknown): GeneratedGoalPlan {
    const parsed = this.requireObject(value, "response") as DeepSeekPlanResponse;
    const summary = this.requireString(parsed.summary, "summary");
    const milestones = this.requireArray(parsed.milestones, "milestones").map(
      (item, index) => this.parseMilestone(item, index)
    );
    const weeklyPlans = this.requireArray(parsed.weeklyPlans, "weeklyPlans").map(
      (item, index) => this.parseWeeklyPlan(item, index)
    );

    if (!milestones.length || !weeklyPlans.length) {
      throw new Error("DeepSeek plan is missing milestones or weekly plans");
    }

    return {
      summary,
      milestones,
      weeklyPlans
    };
  }

  private parseMilestone(value: unknown, index: number): GeneratedMilestone {
    const item = this.requireObject(value, `milestones[${index}]`);

    return {
      title: this.requireString(item.title, `milestones[${index}].title`),
      description: this.optionalString(item.description) ?? "阶段目标待细化。",
      targetDate: this.parseDate(item.targetDate, `milestones[${index}].targetDate`),
      rewardText: this.optionalString(item.rewardText)
    };
  }

  private parseWeeklyPlan(value: unknown, index: number): GeneratedWeeklyPlan {
    const item = this.requireObject(value, `weeklyPlans[${index}]`);

    return {
      weekIndex: this.optionalInteger(item.weekIndex) ?? index + 1,
      title: this.requireString(item.title, `weeklyPlans[${index}].title`),
      summary: this.requireString(item.summary, `weeklyPlans[${index}].summary`),
      startsOn: this.parseDate(item.startsOn, `weeklyPlans[${index}].startsOn`),
      endsOn: this.parseDate(item.endsOn, `weeklyPlans[${index}].endsOn`),
      dailyTasks: this.requireArray(item.dailyTasks, `weeklyPlans[${index}].dailyTasks`)
        .map((task, taskIndex) => this.parseDailyTask(task, index, taskIndex))
    };
  }

  private parseDailyTask(
    value: unknown,
    weekIndex: number,
    taskIndex: number
  ): GeneratedDailyTask {
    const item = this.requireObject(value, `weeklyPlans[${weekIndex}].dailyTasks[${taskIndex}]`);

    return {
      taskDate: this.parseDate(
        item.taskDate,
        `weeklyPlans[${weekIndex}].dailyTasks[${taskIndex}].taskDate`
      ),
      title: this.requireString(
        item.title,
        `weeklyPlans[${weekIndex}].dailyTasks[${taskIndex}].title`
      ),
      description: this.requireString(
        item.description,
        `weeklyPlans[${weekIndex}].dailyTasks[${taskIndex}].description`
      ),
      plannedMinutes: this.optionalInteger(item.plannedMinutes),
      studyTaskType: this.optionalString(item.studyTaskType),
      subject: this.optionalString(item.subject),
      materialRef: this.optionalString(item.materialRef),
      chapterRef: this.optionalString(item.chapterRef),
      questionCount: this.optionalInteger(item.questionCount),
      targetAccuracy: this.optionalInteger(item.targetAccuracy),
      evidenceRequired: this.optionalBoolean(item.evidenceRequired),
      priority: this.optionalInteger(item.priority)
    };
  }

  private requireObject(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`DeepSeek plan field ${field} must be an object`);
    }

    return value as Record<string, unknown>;
  }

  private requireArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
      throw new Error(`DeepSeek plan field ${field} must be an array`);
    }

    return value;
  }

  private requireString(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`DeepSeek plan field ${field} must be a string`);
    }

    return value.trim();
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private optionalInteger(value: unknown) {
    const numberValue = Number(value);

    return Number.isInteger(numberValue) ? numberValue : undefined;
  }

  private optionalBoolean(value: unknown) {
    return typeof value === "boolean" ? value : undefined;
  }

  private parseDate(value: unknown, field: string) {
    const dateText = this.requireString(value, field);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateText)
      ? new Date(`${dateText}T00:00:00.000+08:00`)
      : new Date(dateText);

    if (Number.isNaN(date.getTime())) {
      throw new Error(`DeepSeek plan field ${field} must be a valid date`);
    }

    return date;
  }
}

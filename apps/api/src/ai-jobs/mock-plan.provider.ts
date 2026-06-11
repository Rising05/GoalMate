import { Injectable } from "@nestjs/common";
import { Goal } from "@prisma/client";
import { PlanProvider } from "./plan-provider";

export interface GeneratedMilestone {
  title: string;
  description: string;
  targetDate: Date;
  rewardText?: string;
}

export interface GeneratedWeeklyPlan {
  weekIndex: number;
  title: string;
  summary: string;
  startsOn: Date;
  endsOn: Date;
  dailyTasks: GeneratedDailyTask[];
}

export interface GeneratedDailyTask {
  taskDate: Date;
  title: string;
  description: string;
  plannedMinutes?: number;
}

export interface GeneratedGoalPlan {
  summary: string;
  milestones: GeneratedMilestone[];
  weeklyPlans: GeneratedWeeklyPlan[];
}

@Injectable()
export class MockPlanProvider implements PlanProvider {
  readonly name = "mock";

  generate(goal: Goal): GeneratedGoalPlan {
    const start = startOfDay(goal.startDate);
    const end = startOfDay(goal.endDate);
    const totalDays = Math.max(1, differenceInDays(start, end) + 1);
    const weekCount = Math.max(1, Math.ceil(totalDays / 7));
    const plannedMinutes = goal.dailyTimeBudgetMinutes ?? 45;

    return {
      summary: `围绕“${goal.title}”生成 ${weekCount} 周计划：先建立基础节奏，再推进阶段产出，最后完成复盘与验收。`,
      milestones: buildMilestones(goal, start, totalDays),
      weeklyPlans: Array.from({ length: weekCount }, (_, index) => {
        const weekIndex = index + 1;
        const startsOn = addDays(start, index * 7);
        const endsOn = minDate(addDays(startsOn, 6), end);

        return {
          weekIndex,
          title: `第 ${weekIndex} 周：${getWeekTheme(weekIndex, weekCount)}`,
          summary: buildWeeklySummary(goal, weekIndex, weekCount),
          startsOn,
          endsOn,
          dailyTasks: buildDailyTasks(goal, startsOn, endsOn, plannedMinutes)
        };
      })
    };
  }
}

function buildMilestones(goal: Goal, start: Date, totalDays: number) {
  const points = [
    {
      ratio: 0.33,
      title: "完成基础搭建",
      description: `明确 ${goal.title} 的执行节奏、关键资料和第一批输出。`
    },
    {
      ratio: 0.66,
      title: "形成阶段成果",
      description: "进入稳定推进期，完成可检查的阶段产出并调整计划。"
    },
    {
      ratio: 1,
      title: "完成目标验收",
      description: "整理最终成果、复盘执行过程，并确认奖励兑现条件。"
    }
  ];

  return points.map((point) => ({
    title: point.title,
    description: point.description,
    targetDate: addDays(start, Math.max(0, Math.ceil(totalDays * point.ratio) - 1)),
    rewardText: point.ratio === 1 ? goal.finalReward ?? undefined : undefined
  }));
}

function buildDailyTasks(
  goal: Goal,
  startsOn: Date,
  endsOn: Date,
  plannedMinutes: number
) {
  const dayCount = differenceInDays(startsOn, endsOn) + 1;

  return Array.from({ length: dayCount }, (_, index) => {
    const taskDate = addDays(startsOn, index);
    const dayInWeek = index % 7;

    if (dayInWeek === 5) {
      return {
        taskDate,
        title: "阶段复盘与问题整理",
        description: `复盘本周围绕“${goal.title}”的完成情况，记录卡点、证据和下周调整项。`,
        plannedMinutes
      };
    }

    if (dayInWeek === 6) {
      return {
        taskDate,
        title: "轻量巩固与准备",
        description: "做一次低压力巩固，整理明天开始执行所需材料，避免计划断档。",
        plannedMinutes: Math.max(20, Math.round(plannedMinutes * 0.6))
      };
    }

    return {
      taskDate,
      title: getDailyTaskTitle(dayInWeek),
      description: buildDailyDescription(goal, dayInWeek),
      plannedMinutes
    };
  });
}

function buildWeeklySummary(goal: Goal, weekIndex: number, weekCount: number) {
  if (weekIndex === 1) {
    return `聚焦启动：确认当前基础、拆出可执行任务，并建立每天 ${goal.dailyTimeBudgetMinutes ?? 45} 分钟的节奏。`;
  }

  if (weekIndex === weekCount) {
    return "聚焦收尾：补齐关键缺口，整理最终成果，并完成目标验收复盘。";
  }

  return "聚焦推进：保持稳定输出，按周检查里程碑进度，并根据阻塞调整每日任务。";
}

function buildDailyDescription(goal: Goal, dayInWeek: number) {
  const baseline = goal.currentBaseline
    ? `结合当前基础：${goal.currentBaseline}。`
    : "先从最小可执行步骤开始。";
  const constraints = goal.constraints ? `注意限制：${goal.constraints}。` : "";

  const descriptions = [
    `梳理今天要推进的内容，完成一个清晰的输入或练习。${baseline}`,
    `围绕目标做一次专项练习，并留下可检查的记录。${constraints}`,
    "把前两天的内容转化成小成果，优先完成可以展示或复用的部分。",
    "补齐本周关键薄弱点，记录一个明确问题和一个解决方案。",
    "完成本周主要输出，并标注仍需改进的地方。"
  ];

  return descriptions[dayInWeek] ?? descriptions[0];
}

function getDailyTaskTitle(dayInWeek: number) {
  const titles = [
    "明确今日重点",
    "专项练习推进",
    "产出一个小成果",
    "补齐薄弱环节",
    "完成本周输出"
  ];

  return titles[dayInWeek] ?? "推进目标任务";
}

function getWeekTheme(weekIndex: number, weekCount: number) {
  if (weekIndex === 1) {
    return "启动与校准";
  }

  if (weekIndex === weekCount) {
    return "收尾与验收";
  }

  return "稳定推进";
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function differenceInDays(start: Date, end: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay);
}

function minDate(first: Date, second: Date) {
  return first.getTime() < second.getTime() ? first : second;
}

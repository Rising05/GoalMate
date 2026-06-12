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
  studyTaskType?: string;
  subject?: string;
  materialRef?: string;
  chapterRef?: string;
  questionCount?: number;
  targetAccuracy?: number;
  evidenceRequired?: boolean;
  priority?: number;
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
  const isStudy = isStudyGoal(goal);
  const points = [
    {
      ratio: 0.33,
      title: isStudy ? "完成基础诊断" : "完成基础搭建",
      description: isStudy
        ? `明确 ${goal.title} 的科目重点、薄弱项和第一轮学习节奏。`
        : `明确 ${goal.title} 的执行节奏、关键资料和第一批输出。`
    },
    {
      ratio: 0.66,
      title: isStudy ? "完成强化训练" : "形成阶段成果",
      description: isStudy
        ? "进入稳定刷题和复习期，按科目完成阶段训练并整理错题。"
        : "进入稳定推进期，完成可检查的阶段产出并调整计划。"
    },
    {
      ratio: 1,
      title: isStudy ? "完成冲刺复盘" : "完成目标验收",
      description: isStudy
        ? "完成模考、查漏补缺和考前复盘，确认下一轮提升策略。"
        : "整理最终成果、复盘执行过程，并确认奖励兑现条件。"
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
  const studyProfile = getStudyProfile(goal);

  return Array.from({ length: dayCount }, (_, index) => {
    const taskDate = addDays(startsOn, index);
    const dayInWeek = index % 7;
    const subject = studyProfile.subjects[index % studyProfile.subjects.length];
    const chapterRef = studyProfile.chapters[index % studyProfile.chapters.length];
    const materialRef = studyProfile.materials[index % studyProfile.materials.length];

    if (dayInWeek === 5) {
      return {
        taskDate,
        title: isStudyGoal(goal) ? `${subject} 错题复盘` : "阶段复盘与问题整理",
        description: isStudyGoal(goal)
          ? `复盘本周 ${subject} 的错题和薄弱知识点，整理 3 条可复习证据。`
          : `复盘本周围绕“${goal.title}”的完成情况，记录卡点、证据和下周调整项。`,
        plannedMinutes,
        studyTaskType: isStudyGoal(goal) ? "ERROR_BOOK" : undefined,
        subject: isStudyGoal(goal) ? subject : undefined,
        materialRef: isStudyGoal(goal) ? materialRef : undefined,
        chapterRef: isStudyGoal(goal) ? chapterRef : undefined,
        questionCount: isStudyGoal(goal) ? 10 : undefined,
        targetAccuracy: isStudyGoal(goal) ? 80 : undefined,
        evidenceRequired: isStudyGoal(goal),
        priority: 2
      };
    }

    if (dayInWeek === 6) {
      return {
        taskDate,
        title: isStudyGoal(goal) ? `${subject} 轻量巩固` : "轻量巩固与准备",
        description: isStudyGoal(goal)
          ? `用低压力方式复习 ${chapterRef}，完成少量题目并标记明天要补的卡点。`
          : "做一次低压力巩固，整理明天开始执行所需材料，避免计划断档。",
        plannedMinutes: Math.max(20, Math.round(plannedMinutes * 0.6)),
        studyTaskType: isStudyGoal(goal) ? "REVIEW" : undefined,
        subject: isStudyGoal(goal) ? subject : undefined,
        materialRef: isStudyGoal(goal) ? materialRef : undefined,
        chapterRef: isStudyGoal(goal) ? chapterRef : undefined,
        questionCount: isStudyGoal(goal) ? 8 : undefined,
        targetAccuracy: isStudyGoal(goal) ? 75 : undefined,
        evidenceRequired: false,
        priority: 3
      };
    }

    return {
      taskDate,
      title: isStudyGoal(goal)
        ? getStudyDailyTaskTitle(dayInWeek, subject)
        : getDailyTaskTitle(dayInWeek),
      description: isStudyGoal(goal)
        ? buildStudyDailyDescription(goal, dayInWeek, subject, chapterRef, materialRef)
        : buildDailyDescription(goal, dayInWeek),
      plannedMinutes,
      studyTaskType: isStudyGoal(goal) ? getStudyTaskType(dayInWeek) : undefined,
      subject: isStudyGoal(goal) ? subject : undefined,
      materialRef: isStudyGoal(goal) ? materialRef : undefined,
      chapterRef: isStudyGoal(goal) ? chapterRef : undefined,
      questionCount: isStudyGoal(goal) ? 20 + dayInWeek * 5 : undefined,
      targetAccuracy: isStudyGoal(goal) ? 75 + dayInWeek : undefined,
      evidenceRequired: isStudyGoal(goal),
      priority: dayInWeek === 0 ? 1 : 2
    };
  });
}

function buildWeeklySummary(goal: Goal, weekIndex: number, weekCount: number) {
  if (isStudyGoal(goal)) {
    const examName = goal.examName ? `「${goal.examName}」` : "考试目标";

    if (weekIndex === 1) {
      return `聚焦启动：围绕${examName}完成科目诊断、资料确认和第一轮细分任务。`;
    }

    if (weekIndex === weekCount) {
      return "聚焦冲刺：完成模考复盘、错题回看和薄弱章节查漏补缺。";
    }

    return "聚焦强化：按科目推进章节学习、刷题、错题整理和阶段复盘。";
  }

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

function getStudyDailyTaskTitle(dayInWeek: number, subject: string) {
  const titles = [
    `${subject} 明确今日重点`,
    `${subject} 章节学习`,
    `${subject} 刷题训练`,
    `${subject} 错题整理`,
    `${subject} 阶段小测`
  ];

  return titles[dayInWeek] ?? `${subject} 学习任务`;
}

function buildStudyDailyDescription(
  goal: Goal,
  dayInWeek: number,
  subject: string,
  chapterRef: string,
  materialRef: string
) {
  const target = goal.targetScore ? `目标分数 ${goal.targetScore}。` : "";
  const current = goal.currentScore ? `当前水平 ${goal.currentScore}。` : "";
  const weakness = getStringList(goal.weaknesses)[0];
  const weaknessText = weakness ? `优先关注薄弱项：${weakness}。` : "";
  const descriptions = [
    `梳理 ${subject} 的今日学习重点，定位 ${chapterRef} 的关键概念。${current}${target}`,
    `学习 ${materialRef} 中的 ${chapterRef}，完成例题和笔记整理。${weaknessText}`,
    `围绕 ${chapterRef} 完成限时刷题，并记录错题原因。`,
    `整理 ${subject} 错题，提炼 3 个易错点和 1 个明日复习动作。`,
    `完成 ${subject} 阶段小测，记录正确率、耗时和需要回炉的知识点。`
  ];

  return descriptions[dayInWeek] ?? descriptions[0];
}

function getStudyTaskType(dayInWeek: number) {
  const types = ["REVIEW", "READING", "PRACTICE", "ERROR_BOOK", "MOCK_EXAM"];

  return types[dayInWeek] ?? "PRACTICE";
}

function isStudyGoal(goal: Goal) {
  return [
    "STUDY",
    "POSTGRAD_EXAM",
    "CET_4_6",
    "IELTS_TOEFL",
    "GPA_IMPROVEMENT",
    "CERTIFICATION",
    "CUSTOM_STUDY"
  ].includes(goal.category);
}

function getStudyProfile(goal: Goal) {
  return {
    subjects: getStringList(goal.subjects, ["综合科目"]),
    materials: getStringList(goal.materials, [goal.examName ?? goal.title]),
    chapters: getStringList(goal.chapters, ["核心章节"])
  };
}

function getStringList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const list = value.filter(
    (item): item is string => typeof item === "string" && Boolean(item.trim())
  );

  return list.length ? list : fallback;
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

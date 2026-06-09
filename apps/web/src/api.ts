const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  membership: {
    plan: string;
    status: string;
    expiresAt: string | null;
  } | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  startDate: string;
  endDate: string;
  toleranceDaysAllowed: number;
  toleranceDaysUsed: number;
  dailyTimeBudgetMinutes: number | null;
  currentBaseline: string | null;
  constraints: string | null;
  finalReward: string | null;
}

export interface AiJob {
  id: string;
  goalId: string | null;
  type: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalPlan {
  id: string;
  goalId: string;
  version: number;
  summary: string;
  isActive: boolean;
  confirmedAt: string | null;
  milestones: Milestone[];
  weeklyPlans: WeeklyPlan[];
}

export interface Milestone {
  id: string;
  title: string;
  description: string | null;
  targetDate: string;
  rewardText: string | null;
  isCompleted: boolean;
}

export interface WeeklyPlan {
  id: string;
  weekIndex: number;
  title: string;
  summary: string;
  startsOn: string;
  endsOn: string;
  dailyTasks: DailyTask[];
}

export interface DailyTask {
  id: string;
  goalId: string;
  sourceDailyTaskId?: string | null;
  deviationEventId?: string | null;
  taskDate: string;
  date?: string;
  title: string;
  description: string;
  plannedMinutes: number | null;
  estimatedMinutes?: number;
  taskType?: string;
  rescueReason?: string | null;
  rescueTriggerCode?: DeviationReason["code"] | null;
  rescueRiskLevel?: "stable" | "warning" | "danger" | null;
  status: string;
}

export interface TodayDailyTask extends DailyTask {
  goalTitle: string;
  weeklyPlanId: string | null;
  weeklyPlanTitle: string | null;
  date: string;
  latestCheckin: TaskCheckin | null;
}

export interface TaskCheckin {
  id: string;
  dailyTaskId: string | null;
  content: string;
  investedMinutes: number | null;
  submittedAt: string;
  aiScore: {
    totalScore: number;
    dimensions?: Record<string, number>;
    evidence?: Record<string, unknown>;
    summary: string;
    suggestion: string;
  } | null;
}

export interface ActivityDay {
  date: string;
  level: number;
  completedTaskCount: number;
  investedMinutes: number;
  averageScore: number | null;
  tasks: ActivityTask[];
}

export interface ActivityTask {
  id: string;
  goalId: string;
  goalTitle: string;
  title: string;
  description: string;
  plannedMinutes: number | null;
  taskType?: string;
  deviationEventId?: string | null;
  rescueReason?: string | null;
  rescueTriggerCode?: DeviationReason["code"] | null;
  rescueRiskLevel?: "stable" | "warning" | "danger" | null;
  status: string;
  investedMinutes: number | null;
  aiScore: number | null;
  reflection: string | null;
  completedAt: string | null;
}

export interface TimelineDay {
  date: string;
  investedMinutes: number;
  averageScore: number | null;
  items: TimelineItem[];
}

export type TimelineRiskLevel = "stable" | "warning" | "danger";

export interface TimelineSourceTask {
  id: string;
  title: string;
  description: string;
  weeklyPlanTitle: string | null;
  plannedMinutes: number | null;
  status: string;
}

export interface TimelineRescueTask {
  id: string;
  dailyTaskId: string;
  deviationEventId: string | null;
  sourceDailyTaskId: string | null;
  title: string;
  description: string;
  weeklyPlanTitle: string | null;
  plannedMinutes: number | null;
  status: string;
  taskType: string;
  rescueReason: string | null;
  rescueTriggerCode: DeviationReason["code"] | null;
  rescueRiskLevel: TimelineRiskLevel | null;
  createdAt: string;
  completedAt: string | null;
  latestCheckin: TaskCheckin | null;
}

export interface TimelineItem {
  id: string;
  kind: "CHECKIN" | "DEVIATION";
  chainStage: "CHECKIN" | "RESCUE_COMPLETED" | "DEVIATION_CHAIN";
  timelineAt: string;
  date: string;
  submittedAt: string;
  detectedAt: string | null;
  goalId: string;
  goalTitle: string;
  dailyTaskId: string | null;
  sourceDailyTaskId: string | null;
  deviationEventId: string | null;
  taskTitle: string;
  taskDescription: string | null;
  weeklyPlanTitle: string | null;
  plannedMinutes: number | null;
  taskType: string;
  isRescueTask: boolean;
  rescueReason: string | null;
  rescueTriggerCode: DeviationReason["code"] | null;
  rescueRiskLevel: TimelineRiskLevel | null;
  deviationReasons: DeviationReason[];
  deviationMetrics: DeviationSignal["metrics"] | null;
  sourceTask: TimelineSourceTask | null;
  rescueTasks: TimelineRescueTask[];
  investedMinutes: number | null;
  checkin: TaskCheckin | null;
  aiScore: {
    totalScore: number;
    dimensions?: Record<string, number>;
    evidence?: Record<string, unknown>;
    summary: string;
    suggestion: string;
  } | null;
}

export interface GoalHealth {
  goalId: string;
  goalTitle: string;
  status: string;
  healthScore: number;
  todayCompletionRate: number;
  weekCompletionRate: number;
  streakDays: number;
  toleranceRemaining: number;
  averageScore: number | null;
  recentInvestedMinutes: number;
  risks: GoalHealthRisk[];
  deviation: DeviationSignal;
}

export interface GoalHealthRisk {
  level: "warning" | "danger";
  title: string;
  detail: string;
  suggestion: string;
}

export interface DeviationSignal {
  eventId?: string | null;
  detectedAt?: string | null;
  riskLevel: "stable" | "warning" | "danger";
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

export interface DeviationReason {
  code: "LOW_SCORE" | "LOW_INVESTMENT" | "BROKEN_STREAK" | "TASK_DELAY";
  level: "warning" | "danger";
  label: string;
  detail: string;
}

export interface RescueTask {
  id: string;
  goalId: string;
  goalTitle: string;
  weeklyPlanId: string | null;
  weeklyPlanTitle: string | null;
  sourceDailyTaskId: string | null;
  deviationEventId: string | null;
  taskDate: string;
  date: string;
  title: string;
  description: string;
  plannedMinutes: number | null;
  estimatedMinutes: number;
  taskType: string;
  rescueReason: string | null;
  rescueTriggerCode: DeviationReason["code"] | null;
  rescueRiskLevel: "stable" | "warning" | "danger" | null;
  reason: string;
  triggerCode: DeviationReason["code"] | null;
  riskLevel: "stable" | "warning" | "danger" | null;
  status: string;
  latestCheckin: TaskCheckin | null;
  createdAt: string;
}

export interface RewardBoard {
  goalId: string;
  goalTitle: string;
  finalReward: string | null;
  cards: RewardCard[];
  limits: {
    freeCustomCards: number;
    proCustomCards: number;
  };
}

export interface RewardCard {
  id: string;
  goalId: string;
  title: string;
  description: string | null;
  cardType: "TEXT" | "IMAGE" | "LINK";
  sourceType: "FINAL_REWARD" | "MILESTONE_REWARD" | "CUSTOM";
  sourceRefId: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RewardCardInput {
  title?: string;
  description?: string | null;
  cardType?: "TEXT" | "IMAGE" | "LINK";
  imageUrl?: string | null;
  linkUrl?: string | null;
  sortOrder?: number;
}

export interface CreateGoalInput {
  title?: string;
  description: string;
  category: string;
  startDate: string;
  endDate: string;
  dailyTimeBudgetMinutes?: number;
  toleranceDaysAllowed?: number;
  currentBaseline?: string;
  constraints?: string;
  finalReward?: string;
}

export async function authenticate(
  mode: "login" | "register",
  payload: {
    email: string;
    password: string;
    displayName?: string;
  }
) {
  const response = await fetch(`${API_BASE_URL}/auth/${mode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<AuthResponse>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "认证请求失败"));
  }

  return data as AuthResponse;
}

export async function createGoal(token: string, payload: CreateGoalInput) {
  const response = await fetch(`${API_BASE_URL}/goals`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ goal: Goal }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标创建失败"));
  }

  return data as { goal: Goal };
}

export async function listGoals(token: string) {
  const response = await fetch(`${API_BASE_URL}/goals`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ goals: Goal[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标列表加载失败"));
  }

  return data as { goals: Goal[] };
}

export async function generateGoalPlan(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/generate-plan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ job: AiJob; goal: Goal; plan: GoalPlan | null }>(
    response
  );

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "AI 计划生成失败"));
  }

  return data as { job: AiJob; goal: Goal; plan: GoalPlan | null };
}

export async function confirmGoalPlan(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/confirm-plan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ goal: Goal; plan: GoalPlan }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "计划确认失败"));
  }

  return data as { goal: Goal; plan: GoalPlan };
}

export async function fetchGoalPlan(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/plan`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ plan: GoalPlan }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "计划加载失败"));
  }

  return data as { plan: GoalPlan };
}

export async function fetchGoalHealth(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/health`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<GoalHealth>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标健康度加载失败"));
  }

  return data as GoalHealth;
}

export async function generateRescueTask(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/rescue-task`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{
    goalId: string;
    goalTitle: string;
    deviation: DeviationSignal;
    rescueTask: RescueTask;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "救援任务生成失败"));
  }

  return data as {
    goalId: string;
    goalTitle: string;
    deviation: DeviationSignal;
    rescueTask: RescueTask;
  };
}

export async function fetchRewardBoard(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/rewards`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<RewardBoard>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "奖励愿景板加载失败"));
  }

  return data as RewardBoard;
}

export async function createRewardCard(
  token: string,
  goalId: string,
  payload: RewardCardInput
) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/rewards`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ card: RewardCard }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "奖励卡片保存失败"));
  }

  return data as { card: RewardCard };
}

export async function updateRewardCard(
  token: string,
  goalId: string,
  cardId: string,
  payload: RewardCardInput
) {
  const response = await fetch(
    `${API_BASE_URL}/goals/${goalId}/rewards/${cardId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await parseJson<{ card: RewardCard }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "奖励卡片更新失败"));
  }

  return data as { card: RewardCard };
}

export async function deleteRewardCard(
  token: string,
  goalId: string,
  cardId: string
) {
  const response = await fetch(
    `${API_BASE_URL}/goals/${goalId}/rewards/${cardId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await parseJson<{ deletedId: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "奖励卡片删除失败"));
  }

  return data as { deletedId: string };
}

export async function fetchTodayTasks(token: string, goalId?: string) {
  const url = new URL(`${API_BASE_URL}/daily-tasks/today`);

  if (goalId) {
    url.searchParams.set("goalId", goalId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ date: string; tasks: TodayDailyTask[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "今日任务加载失败"));
  }

  return data as { date: string; tasks: TodayDailyTask[] };
}

export async function completeDailyTask(
  token: string,
  taskId: string,
  payload: {
    content: string;
    investedMinutes?: number;
  }
) {
  const response = await fetch(`${API_BASE_URL}/daily-tasks/${taskId}/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{
    task: TodayDailyTask;
    checkin: TaskCheckin;
    job: AiJob;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "任务完成提交失败"));
  }

  return data as { task: TodayDailyTask; checkin: TaskCheckin; job: AiJob };
}

export async function fetchTaskActivity(
  token: string,
  year: number,
  goalId?: string
) {
  const url = new URL(`${API_BASE_URL}/daily-tasks/activity`);
  url.searchParams.set("year", String(year));

  if (goalId) {
    url.searchParams.set("goalId", goalId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ year: number; days: ActivityDay[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "成长热力图加载失败"));
  }

  return data as { year: number; days: ActivityDay[] };
}

export async function fetchTaskTimeline(token: string, goalId?: string) {
  const url = new URL(`${API_BASE_URL}/daily-tasks/timeline`);

  if (goalId) {
    url.searchParams.set("goalId", goalId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ items: TimelineItem[]; days: TimelineDay[] }>(
    response
  );

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "成长时间线加载失败"));
  }

  return data as { items: TimelineItem[]; days: TimelineDay[] };
}

async function parseJson<T>(response: Response) {
  return (await response.json().catch(() => null)) as
    | T
    | { message?: string | string[] }
    | null;
}

function getErrorMessage(
  data: unknown,
  fallback: string
) {
  if (!data || typeof data !== "object" || !("message" in data)) {
    return fallback;
  }

  const message = (data as { message?: unknown }).message;

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message.filter((item) => typeof item === "string").join("；");
  }

  return fallback;
}

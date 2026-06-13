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
  adminRole: string | null;
  quota: {
    plan: string;
    hasProAccess: boolean;
    activeGoals: {
      used: number;
      limit: number;
    };
    aiJobsToday: {
      used: number;
      limit: number;
    };
    replansThisWeek: {
      used: number;
      limit: number;
    };
    scoreAppealsThisWeek: {
      used: number;
      limit: number;
    };
  };
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
  examName: string | null;
  targetScore: string | null;
  currentScore: string | null;
  examDate: string | null;
  subjects: string[];
  materials: string[];
  chapters: string[];
  weaknesses: string[];
  studyDaysPerWeek: number | null;
  dailyStudyMinutes: number | null;
  mockExamFrequency: string | null;
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
  studyTaskType?: string | null;
  subject?: string | null;
  materialRef?: string | null;
  chapterRef?: string | null;
  questionCount?: number | null;
  targetAccuracy?: number | null;
  evidenceRequired?: boolean;
  priority?: number | null;
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
  completedSubtasks: string[];
  actualQuestionCount: number | null;
  correctQuestionCount: number | null;
  accuracy: number | null;
  evidenceFiles: string[];
  evidenceLinks: string[];
  studyMood: string | null;
  difficultyLevel: string | null;
  submittedAt: string;
  aiScore: {
    totalScore: number;
    analysisLevel: "BASIC" | "PRO";
    isDetailedAnalysisUnlocked: boolean;
    dimensions: Record<string, number> | null;
    evidence: Record<string, unknown> | null;
    summary: string | null;
    suggestion: string | null;
  } | null;
}

export interface ScoreAppeal {
  id: string;
  userId: string;
  checkinId: string;
  reason: string;
  addedFacts: string;
  status: string;
  originalScore: number;
  newScore: number | null;
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityDay {
  date: string;
  level: number;
  healthScore: number;
  completionRate: number;
  totalTaskCount: number;
  completedTaskCount: number;
  plannedMinutes: number;
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
    analysisLevel: "BASIC" | "PRO";
    isDetailedAnalysisUnlocked: boolean;
    dimensions: Record<string, number> | null;
    evidence: Record<string, unknown> | null;
    summary: string | null;
    suggestion: string | null;
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
  rescueSuccessCount7d: number;
  rescueTaskCompletionRate: number;
  normalTaskCompletionRate: number;
  rescueNextDayRecovered: boolean | null;
  completionMetrics: HealthCompletionMetrics;
  rescueMetrics: HealthRescueMetrics;
  healthWeights: {
    healthScoreFormula: string;
    taskTypeWeights: {
      normal: number;
      rescue: number;
    };
    note: string;
  };
  snapshot: HealthSnapshot;
  risks: GoalHealthRisk[];
  deviation: DeviationSignal;
}

export interface HealthCompletionMetrics {
  todayCompletionRate: number;
  weekCompletionRate: number;
  recentNormalTaskCount: number;
  recentNormalTaskCompletedCount: number;
  recentNormalTaskCompletionRate: number;
  recentRescueTaskCount: number;
  recentRescueTaskCompletedCount: number;
  recentRescueTaskCompletionRate: number;
  taskTypeWeights: {
    normal: number;
    rescue: number;
  };
}

export interface HealthRescueMetrics {
  recentRescueSuccessCount: number;
  rescueTaskCompletionRate: number;
  rescueNextDayRecovered: boolean | null;
  nextDayNormalTaskCompletionRate: number | null;
  lastCompletedRescueTaskId: string | null;
}

export interface HealthSnapshot {
  id: string;
  goalId: string;
  date: string;
  healthScore: number;
  deviationEventId: string | null;
  completionMetrics: Record<string, unknown>;
  rescueMetrics: Record<string, unknown>;
  riskLevel: "stable" | "warning" | "danger";
  createdAt: string;
  updatedAt: string;
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

export interface FailureReport {
  id: string;
  goalId: string;
  goalTitle?: string;
  reasonAnalysis: string;
  brokenStreakTimeline: Array<{
    date: string;
    taskCount: number;
    pendingTaskTitles: string[];
  }>;
  lowScoreTasks: Array<{
    checkinId: string;
    dailyTaskId: string | null;
    taskTitle: string;
    submittedAt: string;
    totalScore: number | null;
    summary: string | null;
    suggestion: string | null;
  }>;
  keyDeviationNodes: Array<{
    id: string;
    detectedAt: string;
    riskLevel: string;
    primaryReasonCode: string | null;
    primaryReasonLabel: string | null;
    primaryReasonDetail: string | null;
    metrics: Record<string, unknown>;
  }>;
  suggestion: string;
  restartGoalDraft: Partial<CreateGoalInput>;
  createdAt: string;
  updatedAt: string;
}

export interface GoalSettlement {
  status: string;
  reachedEndDate: boolean;
  toleranceDaysUsed: number;
  toleranceDaysAllowed: number;
  missedDays: Array<{
    date: string;
    taskCount: number;
    pendingTaskTitles: string[];
  }>;
}

export interface GoalSettlementResponse {
  goal: Goal;
  settlement: GoalSettlement;
  failureReport: FailureReport | null;
}

export type ReminderType =
  | "DAILY_TASK"
  | "MISSED_CHECKIN"
  | "TOLERANCE_RISK"
  | "MILESTONE"
  | "FAILURE_REVIEW"
  | "MEMBERSHIP_EXPIRY";

export type NotificationChannel = "WEB" | "EMAIL" | "WECHAT";

export interface NotificationPreference {
  id: string;
  userId: string;
  enabled: boolean;
  reminderTime: string;
  reminderTypes: ReminderType[];
  channels: NotificationChannel[];
  timezone: string;
  createdAt: string;
  updatedAt: string;
  availableTypes: Array<{
    code: ReminderType;
    label: string;
  }>;
  availableChannels: Array<{
    code: NotificationChannel;
    label: string;
  }>;
}

export interface EmailLog {
  id: string;
  userId: string;
  goalId: string | null;
  channel: NotificationChannel;
  type: string;
  recipientEmail: string;
  subject: string;
  content: string;
  status: string;
  attempts: number;
  error: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WechatBinding {
  id: string;
  userId: string;
  openId: string;
  unionId: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  status: string;
  boundAt: string;
  createdAt: string;
  updatedAt: string;
}

export type DataExportFormat = "JSON" | "CSV" | "PDF" | "EXCEL";

export type DataExportScope =
  | "profile"
  | "membership"
  | "goals"
  | "plans"
  | "milestones"
  | "dailyTasks"
  | "checkins"
  | "aiScores"
  | "scoreAppeals"
  | "deviationEvents"
  | "healthSnapshots"
  | "rewardCards"
  | "failureReports"
  | "aiJobs"
  | "notificationPreference"
  | "emailLogs"
  | "wechatBinding"
  | "adminProfile"
  | "auditLogs";

export interface DataExportResponse {
  exportId: string;
  userId: string;
  exportedAt: string;
  format: DataExportFormat;
  status: "READY" | "RESERVED";
  fullExport: boolean;
  scopes: DataExportScope[];
  data: Record<string, unknown> | null;
  download?: null;
  message: string;
}

export interface AdminOverview {
  admin: {
    role: string;
    status: string;
  };
  metrics: {
    users: number;
    activeGoals: number;
    atRiskGoals: number;
    failedAiJobs: number;
    pendingAiJobs: number;
    proMemberships: number;
    queuedEmails: number;
  };
  recentAuditLogs: AdminAuditLog[];
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  membership: {
    id: string;
    userId: string;
    plan: string;
    status: string;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  adminRole: string | null;
  counts: {
    goals: number;
    aiJobs: number;
    emailLogs: number;
  };
}

export interface AdminUserFilters {
  query?: string;
  status?: string;
  plan?: string;
  adminRole?: string;
}

export interface AdminGoal {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  title: string;
  category: string;
  status: string;
  startDate: string;
  endDate: string;
  toleranceDaysAllowed: number;
  toleranceDaysUsed: number;
  createdAt: string;
  updatedAt: string;
  counts: {
    dailyTasks: number;
    checkins: number;
    deviationEvents: number;
    rewardCards: number;
  };
}

export interface AdminAiJob {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  goalId: string | null;
  goalTitle: string | null;
  goalStatus: string | null;
  type: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAiJobRetryResponse {
  job: AdminAiJob;
  queue: {
    queued: boolean;
    queueName: string;
    jobId?: string;
    reason?: string;
    error?: string;
  };
}

export interface AdminEmailLog extends Omit<EmailLog, "content"> {
  userEmail: string;
  userDisplayName: string | null;
}

export interface AdminAuditLog {
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminSystemConfig {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRawContent {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    createdAt: string;
  };
  goals: Array<{
    id: string;
    title: string;
    description: string;
    currentBaseline: string | null;
    constraints: string | null;
    finalReward: string | null;
    status: string;
    createdAt: string;
    checkins: Array<{
      id: string;
      taskTitle: string | null;
      content: string;
      investedMinutes: number | null;
      completedSubtasks: unknown;
      actualQuestionCount: number | null;
      correctQuestionCount: number | null;
      accuracy: number | null;
      evidenceFiles: unknown;
      evidenceLinks: unknown;
      studyMood: string | null;
      difficultyLevel: string | null;
      submittedAt: string;
      aiScore: {
        totalScore: number;
        summary: string;
        suggestion: string;
        evidence: unknown;
      } | null;
    }>;
    rewardCards: Array<{
      id: string;
      title: string;
      description: string | null;
      cardType: string;
      sourceType: string;
      imageUrl: string | null;
      linkUrl: string | null;
    }>;
    deviationEvents: Array<{
      id: string;
      riskLevel: string;
      primaryReasonCode: string | null;
      primaryReasonLabel: string | null;
      primaryReasonDetail: string | null;
      reasons: unknown;
      metrics: unknown;
      detectedAt: string;
    }>;
  }>;
}

export interface CreateGoalInput {
  title?: string;
  description: string;
  category: string;
  startDate: string;
  endDate: string;
  dailyTimeBudgetMinutes?: number;
  examName?: string;
  targetScore?: string;
  currentScore?: string;
  examDate?: string;
  subjects?: string[] | string;
  materials?: string[] | string;
  chapters?: string[] | string;
  weaknesses?: string[] | string;
  studyDaysPerWeek?: number;
  dailyStudyMinutes?: number;
  mockExamFrequency?: string;
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

export async function deleteCurrentAccount(token: string) {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ deletedUserId: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "账号删除失败"));
  }

  return data as { deletedUserId: string };
}

export async function exportCurrentAccountData(
  token: string,
  payload: {
    format: DataExportFormat;
    fullExport: boolean;
    scopes: DataExportScope[];
  }
) {
  const response = await fetch(`${API_BASE_URL}/auth/export`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<DataExportResponse>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "数据导出失败"));
  }

  return data as DataExportResponse;
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

export async function deleteGoal(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ deletedGoalId: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标删除失败"));
  }

  return data as { deletedGoalId: string };
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

export async function requestGoalReplan(
  token: string,
  goalId: string,
  payload: {
    adjustmentReason: string;
    constraints?: string;
    currentBaseline?: string;
    dailyTimeBudgetMinutes?: number;
  }
) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/request-replan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ job: AiJob; goal: Goal; plan: GoalPlan | null }>(
    response
  );

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "计划调整失败"));
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

export async function fetchGoalHealthSnapshots(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/health-snapshots`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ goalId: string; snapshots: HealthSnapshot[] }>(
    response
  );

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "健康快照加载失败"));
  }

  return data as { goalId: string; snapshots: HealthSnapshot[] };
}

export async function fetchAiJob(token: string, jobId: string) {
  const response = await fetch(`${API_BASE_URL}/ai-jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ job: AiJob }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "AI 任务状态加载失败"));
  }

  return data as { job: AiJob };
}

export async function settleGoal(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/settle`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<GoalSettlementResponse>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标状态结算失败"));
  }

  return data as GoalSettlementResponse;
}

export async function fetchFailureReport(token: string, goalId: string) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/failure-report`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<FailureReport>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "失败复盘加载失败"));
  }

  return data as FailureReport;
}

export async function restartGoal(
  token: string,
  goalId: string,
  payload: Partial<CreateGoalInput> = {}
) {
  const response = await fetch(`${API_BASE_URL}/goals/${goalId}/restart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ goal: Goal; sourceGoalId: string }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "重新开启目标失败"));
  }

  return data as { goal: Goal; sourceGoalId: string };
}

export async function fetchNotificationPreference(token: string) {
  const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<NotificationPreference>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "提醒偏好加载失败"));
  }

  return data as NotificationPreference;
}

export async function updateNotificationPreference(
  token: string,
  payload: {
    enabled: boolean;
    reminderTime: string;
    reminderTypes: ReminderType[];
    channels?: NotificationChannel[];
    timezone?: string;
  }
) {
  const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<NotificationPreference>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "提醒偏好保存失败"));
  }

  return data as NotificationPreference;
}

export async function fetchWechatBinding(token: string) {
  const response = await fetch(`${API_BASE_URL}/notifications/wechat-binding`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ binding: WechatBinding | null }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "微信绑定状态加载失败"));
  }

  return data as { binding: WechatBinding | null };
}

export async function bindWechat(
  token: string,
  payload: {
    openId: string;
    unionId?: string;
    nickname?: string;
    avatarUrl?: string;
  }
) {
  const response = await fetch(`${API_BASE_URL}/notifications/wechat-binding`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ binding: WechatBinding }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "微信账号绑定失败"));
  }

  return data as { binding: WechatBinding };
}

export async function unbindWechat(token: string) {
  const response = await fetch(`${API_BASE_URL}/notifications/wechat-binding`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ unbound: boolean }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "微信账号解绑失败"));
  }

  return data as { unbound: boolean };
}

export async function fetchEmailLogs(token: string) {
  const response = await fetch(`${API_BASE_URL}/notifications/email-logs`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ logs: EmailLog[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "邮件日志加载失败"));
  }

  return data as { logs: EmailLog[] };
}

export async function createPreviewEmailLog(
  token: string,
  payload: {
    type?: ReminderType;
    goalId?: string | null;
  } = {}
) {
  const response = await fetch(`${API_BASE_URL}/notifications/email-logs/preview`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ log: EmailLog }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "提醒预览创建失败"));
  }

  return data as { log: EmailLog };
}

export async function enqueueDueEmailLogs(token: string) {
  const response = await fetch(`${API_BASE_URL}/notifications/email-logs/enqueue-due`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  const data = await parseJson<{ queued: EmailLog[]; skipped: string[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "提醒队列生成失败"));
  }

  return data as { queued: EmailLog[]; skipped: string[] };
}

export async function processQueuedEmailLogs(token: string) {
  const response = await fetch(
    `${API_BASE_URL}/notifications/email-logs/process-queue`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    }
  );

  const data = await parseJson<{
    processed: EmailLog[];
    sent: number;
    failed: number;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "邮件队列处理失败"));
  }

  return data as { processed: EmailLog[]; sent: number; failed: number };
}

export async function retryFailedEmailLogs(token: string) {
  const response = await fetch(`${API_BASE_URL}/notifications/email-logs/retry-failed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  const data = await parseJson<{ retried: EmailLog[]; skipped: string[] }>(
    response
  );

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "失败邮件重试失败"));
  }

  return data as { retried: EmailLog[]; skipped: string[] };
}

export async function fetchAdminOverview(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/overview`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<AdminOverview>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台概览加载失败"));
  }

  return data as AdminOverview;
}

export async function fetchAdminUsers(
  token: string,
  filters: AdminUserFilters = {}
) {
  const url = new URL(`${API_BASE_URL}/admin/users`);

  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{
    users: AdminUser[];
    total: number;
    filters: AdminUserFilters;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台用户列表加载失败"));
  }

  return data as {
    users: AdminUser[];
    total: number;
    filters: AdminUserFilters;
  };
}

export async function fetchAdminGoals(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/goals`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ goals: AdminGoal[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台目标列表加载失败"));
  }

  return data as { goals: AdminGoal[] };
}

export async function fetchAdminAiJobs(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/ai-jobs`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ jobs: AdminAiJob[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台 AI 任务加载失败"));
  }

  return data as { jobs: AdminAiJob[] };
}

export async function retryAdminAiJob(
  token: string,
  jobId: string,
  payload: { reason: string }
) {
  const response = await fetch(`${API_BASE_URL}/admin/ai-jobs/${jobId}/retry`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<AdminAiJobRetryResponse>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "AI 任务重试失败"));
  }

  return data as AdminAiJobRetryResponse;
}

export async function fetchAdminEmailLogs(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/email-logs`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ logs: AdminEmailLog[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台邮件日志加载失败"));
  }

  return data as { logs: AdminEmailLog[] };
}

export async function updateAdminMembership(
  token: string,
  userId: string,
  payload: {
    plan: "FREE" | "PRO";
    status: "ACTIVE" | "EXPIRED" | "MANUAL";
    expiresAt?: string | null;
    reason?: string;
  }
) {
  const response = await fetch(`${API_BASE_URL}/admin/users/${userId}/membership`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ membership: AdminUser["membership"] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "会员状态更新失败"));
  }

  return data as { membership: AdminUser["membership"] };
}

export async function fetchAdminRawContent(
  token: string,
  userId: string,
  reason: string
) {
  const url = new URL(`${API_BASE_URL}/admin/users/${userId}/raw-content`);
  url.searchParams.set("reason", reason);
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<AdminRawContent>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "敏感原文加载失败"));
  }

  return data as AdminRawContent;
}

export async function fetchAdminAuditLogs(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/audit-logs`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ logs: AdminAuditLog[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "审计日志加载失败"));
  }

  return data as { logs: AdminAuditLog[] };
}

export async function fetchAdminSystemConfigs(token: string) {
  const response = await fetch(`${API_BASE_URL}/admin/system-configs`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ configs: AdminSystemConfig[] }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "系统配置加载失败"));
  }

  return data as { configs: AdminSystemConfig[] };
}

export async function upsertAdminSystemConfig(
  token: string,
  payload: {
    key: string;
    value: unknown;
    description?: string | null;
    reason?: string;
  }
) {
  const response = await fetch(`${API_BASE_URL}/admin/system-configs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ config: AdminSystemConfig }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "系统配置保存失败"));
  }

  return data as { config: AdminSystemConfig };
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
    completedSubtasks?: string[] | string;
    actualQuestionCount?: number;
    correctQuestionCount?: number;
    accuracy?: number;
    evidenceFiles?: string[] | string;
    evidenceLinks?: string[] | string;
    studyMood?: string;
    difficultyLevel?: string;
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

export async function appealCheckinScore(
  token: string,
  checkinId: string,
  payload: {
    reason: string;
    addedFacts: string;
  }
) {
  const response = await fetch(
    `${API_BASE_URL}/daily-tasks/checkins/${checkinId}/appeal`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await parseJson<{
    appeal: ScoreAppeal;
    checkin: TaskCheckin;
    job: AiJob;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "评分申诉提交失败"));
  }

  return data as { appeal: ScoreAppeal; checkin: TaskCheckin; job: AiJob };
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

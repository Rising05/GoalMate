const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = configuredApiBaseUrl || "/api";

function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL.replace(/\/$/, "")}${normalizedPath}`;
}

function apiSearchUrl(path: string) {
  return new URL(apiUrl(path), window.location.origin);
}

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
  legalConsent: {
    termsVersion: string | null;
    termsAcceptedAt: string | null;
    privacyVersion: string | null;
    privacyAcceptedAt: string | null;
    aiDisclosureVersion: string | null;
    aiDisclosureAcceptedAt: string | null;
    requiresTermsAcceptance: boolean;
    currentTermsVersion: string;
    currentPrivacyVersion: string;
    currentAiDisclosureVersion: string;
  };
  quota: {
    plan: string;
    hasProAccess: boolean;
    activeGoals: QuotaMetric;
    aiJobsToday: QuotaMetric;
    replansThisWeek: QuotaMetric;
    scoreAppealsThisWeek: QuotaMetric;
    planGenerationsThisMonth: QuotaMetric;
    reportsThisMonth: QuotaMetric;
    rewardCards: QuotaMetric;
    uploadStorageBytes: QuotaMetric;
    capabilities: Record<string, QuotaMetric>;
  };
}

export interface QuotaMetric {
  used: number;
  limit: number | null;
  resetAt?: string | null;
  period?: string;
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
  goalId?: string;
  title: string;
  description: string | null;
  targetDate: string;
  rewardText: string | null;
  isCompleted: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  evidenceFiles: EvidenceFile[];
  evidenceLinks: string[];
  studyMood: string | null;
  difficultyLevel: string | null;
  submittedAt: string;
  aiScore: {
    totalScore: number | null;
    analysisLevel: "BASIC" | "PRO";
    isDetailedAnalysisUnlocked: boolean;
    dimensions: Record<string, number> | null;
    evidence: Record<string, unknown> | null;
    summary: string | null;
    suggestion: string | null;
  } | null;
}

export type EvidenceFile =
  | string
  | {
      uploadId: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      checksumSha256: string | null;
      storageProvider: string;
      objectKey: string;
      url: string;
      status?: string;
      scanStatus?: string;
    };

export interface UploadAsset {
  id: string;
  userId: string;
  source: "WEB" | "WECHAT" | string;
  purpose: "CHECKIN_EVIDENCE" | "ERROR_NOTE" | "STUDY_NOTE" | string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  storageProvider: string;
  objectKey: string;
  publicUrl: string | null;
  status: string;
  scanStatus: string;
  scanResult: string | null;
  uploadExpiresAt: string | null;
  scanAttempts: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceUploadResponse {
  asset: UploadAsset;
  evidenceFile: Exclude<EvidenceFile, string>;
  upload?: { method: "PUT"; url: string; headers?: Record<string, string>; expiresAt: string } | null;
  download?: { method: "GET"; url: string; expiresAt: string } | null;
  queue?: { queued: boolean; queueName: string } | null;
}

export interface BillingOrder {
  id: string;
  provider: "MOCK" | "STRIPE" | "WECHAT_PAY" | string;
  plan: string;
  planCode: string | null;
  planName: string | null;
  durationDays: number;
  amountCents: number;
  currency: string;
  status: string;
  providerOrderId: string | null;
  subscriptionId: string | null;
  subscription: {
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  payments: Array<{
    type: string;
    status: string;
    amountCents: number;
    refundedCents: number;
    createdAt: string;
  }>;
  checkoutUrl: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
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

export interface GrowthEvent {
  id: string;
  userId: string;
  goalId: string;
  goalTitle: string | null;
  type: string;
  sourceResourceType: string;
  sourceResourceId: string;
  occurredAt: string;
  metadata: Record<string, unknown> | null;
  derived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthEventDay {
  date: string;
  events: GrowthEvent[];
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
    totalScore: number | null;
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

export type GoalReportType = "HEALTH_SNAPSHOT" | "WEEKLY_TREND" | "MONTHLY_TREND";

export interface GoalReportQueueResult {
  report: {
    type: GoalReportType;
    userId: string;
    goalId: string;
    reportDate: string | null;
  };
  queue: {
    queued: boolean;
    queueName: string;
    reason?: string;
    error?: string;
    jobId?: string;
  };
}

export interface HealthTrendReport {
  type: Extract<GoalReportType, "WEEKLY_TREND" | "MONTHLY_TREND">;
  goalId: string;
  goalTitle: string;
  range: {
    startsOn: string;
    endsOn: string;
    days: number;
  };
  snapshotCount: number;
  averageHealthScore: number | null;
  previousAverageHealthScore: number | null;
  scoreDelta: number | null;
  trendDirection: "up" | "down" | "flat" | "no_data";
  minHealthScore: number | null;
  maxHealthScore: number | null;
  latestSnapshot: HealthSnapshot | null;
  riskCounts: {
    stable: number;
    warning: number;
    danger: number;
  };
  dominantRiskLevel: "stable" | "warning" | "danger" | "no_data";
  insights: string[];
  generatedAt: string;
}

export interface ReportArtifact {
  id: string;
  goalId: string;
  type: Extract<GoalReportType, "WEEKLY_TREND" | "MONTHLY_TREND">;
  periodStart: string;
  periodEnd: string;
  title: string;
  summary: string;
  recommendations: string[];
  provider: string;
  model: string | null;
  promptVersion: string;
  status: string;
  error: string | null;
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
  job: AiJob | null;
}

export type ReminderType =
  | "DAILY_TASK"
  | "MISSED_CHECKIN"
  | "TOLERANCE_RISK"
  | "MILESTONE"
  | "FAILURE_REVIEW"
  | "MEMBERSHIP_EXPIRY"
  | "DEVIATION_WARNING"
  | "RESCUE_TASK"
  | "WEEKLY_REPORT"
  | "MONTHLY_REPORT"
  | "EXAM_SPRINT";

export type NotificationChannel = "WEB" | "EMAIL" | "WECHAT";

export interface NotificationPreference {
  id: string;
  userId: string;
  enabled: boolean;
  reminderTime: string;
  reminderTypes: ReminderType[];
  channels: NotificationChannel[];
  timezone: string;
  silentDays: number[];
  examSprintDays: number;
  nextScheduledAt: string;
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
  provider: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  error: string | null;
  source: string;
  schedulerRunId: string | null;
  skipReason: string | null;
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
  | "reportArtifacts"
  | "rewardCards"
  | "failureReports"
  | "aiJobs"
  | "notificationPreference"
  | "emailLogs"
  | "wechatBinding"
  | "uploadAssets"
  | "paymentOrders"
  | "subscriptions"
  | "payments"
  | "paymentEvents"
  | "membershipAudits"
  | "entitlements"
  | "usageRecords"
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
  download: {
    filename: string;
    contentType: string;
    encoding: string;
    content: string;
  } | null;
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

export interface AdminGoalFilters {
  query?: string;
  status?: string;
  category?: string;
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

export interface AdminAiJobFilters {
  query?: string;
  status?: string;
  type?: string;
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

export interface AdminEmailLogFilters {
  query?: string;
  status?: string;
  type?: string;
  channel?: string;
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

export interface AdminUploadAsset {
  id: string; userEmail: string; fileName: string; mimeType: string;
  sizeBytes: number; status: string; scanStatus: string; storageProvider: string;
  scanResult: string | null; scanAttempts: number; deleteAttempts: number;
  deleteError: string | null;
  createdAt: string;
}

export interface AdminPaymentEvent {
  id: string; orderId: string | null; userEmail: string; provider: string;
  providerEventId: string; type: string; orderStatus: string | null;
  amountCents: number | null; currency: string | null; createdAt: string;
}

export interface AdminMembershipAudit {
  id: string; userEmail: string; actorEmail: string | null; action: string;
  fromPlan: string | null; toPlan: string; fromStatus: string | null;
  toStatus: string; reason: string | null; createdAt: string;
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

export interface GoalIntakeFormDraft {
  title: string;
  description: string;
  category: string;
  startDate: string;
  endDate: string;
  dailyTimeBudgetMinutes: number | null;
  toleranceDaysAllowed: number;
  examName?: string | null;
  targetScore?: string | null;
  currentScore?: string | null;
  examDate?: string | null;
  subjects?: string[];
  materials?: string[];
  currentBaseline?: string | null;
  constraints?: string | null;
  finalReward?: string | null;
}

export interface GoalIntakeAnalysis {
  provider: string;
  structuredFields: Record<string, unknown>;
  feasible: boolean;
  riskLevel: string;
  feasibilityScore: number;
  reasons: string[];
  assumptions: string[];
  suggestedChanges: string[];
  questions: string[];
  confidence: Record<string, number>;
  missingFields: string[];
  fieldSources: Record<string, string>;
  aiError?: string | null;
}

export interface GoalIntakeDraft {
  id: string;
  status: string;
  provider: string;
  naturalLanguage: string;
  analysis: GoalIntakeAnalysis | null;
  formDraft: GoalIntakeFormDraft | null;
  answers: unknown[];
  acceptedFields: string[];
  completedGoalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function authenticate(
  mode: "login" | "register",
  payload: {
    email: string;
    password: string;
    displayName?: string;
  }
) {
  const response = await fetch(apiUrl(`/auth/${mode}`), {
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

export async function fetchCurrentUser(token: string) {
  const response = await fetch(apiUrl("/auth/me"), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ user: AuthUser }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "登录状态已失效"));
  }

  return data as { user: AuthUser };
}

export async function deleteCurrentAccount(token: string) {
  const response = await fetch(apiUrl("/auth/me"), {
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
  const response = await fetch(apiUrl("/auth/export"), {
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

export async function createEvidenceUpload(
  token: string,
  payload: {
    source?: "WEB" | "WECHAT";
    purpose?: "CHECKIN_EVIDENCE" | "ERROR_NOTE" | "STUDY_NOTE";
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256?: string;
    publicUrl?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const response = await fetch(apiUrl("/uploads/evidence"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<EvidenceUploadResponse>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "上传证据登记失败"));
  }

  return data as EvidenceUploadResponse;
}

export async function getEvidenceUpload(token: string, uploadId: string) {
  const response = await fetch(apiUrl(`/uploads/evidence/${uploadId}`), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<EvidenceUploadResponse>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "上传证据读取失败"));
  }

  return data as EvidenceUploadResponse;
}

export async function uploadEvidenceFile(
  token: string,
  file: File,
  metadata?: Record<string, unknown>,
  onProgress?: (stage: "hashing" | "uploading" | "scanning" | "ready") => void
) {
  onProgress?.("hashing");
  const checksumSha256 = await sha256Hex(await file.arrayBuffer());
  const registered = await createEvidenceUpload(token, {
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    checksumSha256,
    metadata
  });

  if (!registered.upload) {
    throw new Error("上传地址生成失败");
  }

  onProgress?.("uploading");
  const direct = /^https?:\/\//i.test(registered.upload.url);
  const response = await fetch(direct ? registered.upload.url : apiUrl(registered.upload.url), {
    method: "PUT",
    headers: {
      ...registered.upload.headers,
      ...(direct ? {} : { Authorization: `Bearer ${token}` })
    },
    body: file
  });

  if (!response.ok) {
    const data = direct ? null : await parseJson<EvidenceUploadResponse>(response);
    throw new Error(getErrorMessage(data, "证据文件上传失败"));
  }
  onProgress?.("scanning");
  const completed = await completeEvidenceUpload(token, registered.asset.id);
  let current = completed;
  for (let attempt = 0; attempt < 60 && ["UPLOADED", "SCANNING", "SCAN_FAILED"].includes(current.asset.status); attempt += 1) {
    if (current.asset.status === "SCAN_FAILED") throw new Error(current.asset.scanResult || "文件扫描失败，请重试");
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    current = await getEvidenceUpload(token, registered.asset.id);
  }
  if (current.asset.status !== "READY" || current.asset.scanStatus !== "CLEAN") {
    throw new Error(current.asset.status === "QUARANTINED" ? "文件未通过安全扫描" : "文件扫描尚未完成，请稍后重试");
  }
  onProgress?.("ready");
  return current;
}

export async function completeEvidenceUpload(token: string, uploadId: string) {
  const response = await fetch(apiUrl(`/uploads/evidence/${uploadId}/complete`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await parseJson<EvidenceUploadResponse>(response);
  if (!response.ok) throw new Error(getErrorMessage(data, "上传完成校验失败"));
  return data as EvidenceUploadResponse;
}

async function sha256Hex(content: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", content);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createBillingOrder(
  token: string,
  payload: { provider: "MOCK" | "STRIPE" | "WECHAT_PAY"; durationDays: 30 | 90 | 365 }
) {
  const response = await fetch(apiUrl("/billing/orders"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await parseJson<{ order: BillingOrder }>(response);
  if (!response.ok) throw new Error(getErrorMessage(data, "支付订单创建失败"));
  return data as { order: BillingOrder };
}

export async function fetchBillingOrders(token: string) {
  const response = await fetch(apiUrl("/billing/orders"), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await parseJson<{ orders: BillingOrder[] }>(response);
  if (!response.ok) throw new Error(getErrorMessage(data, "支付订单加载失败"));
  return data as { orders: BillingOrder[] };
}

export async function createGoal(token: string, payload: CreateGoalInput) {
  const response = await fetch(apiUrl("/goals"), {
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

export async function createGoalIntakeDraft(
  token: string,
  payload: {
    naturalLanguage: string;
    formDraft?: Partial<GoalIntakeFormDraft>;
  }
) {
  const response = await fetch(apiUrl("/goals/intake-drafts"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ draft: GoalIntakeDraft }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标助手解析失败"));
  }

  return data as { draft: GoalIntakeDraft };
}

export async function fetchLatestGoalIntakeDraft(token: string) {
  const response = await fetch(apiUrl("/goals/intake-drafts/latest"), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{ draft: GoalIntakeDraft | null }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标助手草稿加载失败"));
  }

  return data as { draft: GoalIntakeDraft | null };
}

export async function updateGoalIntakeDraft(
  token: string,
  draftId: string,
  payload: {
    status?: string;
    formDraft?: Partial<GoalIntakeFormDraft>;
    answers?: unknown[];
    acceptedFields?: string[];
  }
) {
  const response = await fetch(apiUrl(`/goals/intake-drafts/${draftId}`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ draft: GoalIntakeDraft }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标助手草稿保存失败"));
  }

  return data as { draft: GoalIntakeDraft };
}

export async function createGoalFromIntakeDraft(
  token: string,
  draftId: string,
  payload: { overrides?: Partial<CreateGoalInput> } = {}
) {
  const response = await fetch(apiUrl(`/goals/intake-drafts/${draftId}/create-goal`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ goal: Goal; draft: GoalIntakeDraft }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标助手创建目标失败"));
  }

  return data as { goal: Goal; draft: GoalIntakeDraft };
}

export async function listGoals(token: string) {
  const response = await fetch(apiUrl("/goals"), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/generate-plan`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/request-replan`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/confirm-plan`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/plan`), {
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

export async function setMilestoneCompletion(
  token: string,
  goalId: string,
  milestoneId: string,
  completed: boolean
) {
  const response = await fetch(
    apiUrl(`/goals/${goalId}/milestones/${milestoneId}/completion`),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ completed })
    }
  );

  const data = await parseJson<{
    milestone: Milestone;
    changed: boolean;
    completed: boolean;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "里程碑状态更新失败"));
  }

  return data as { milestone: Milestone; changed: boolean; completed: boolean };
}

export async function fetchGoalHealth(token: string, goalId: string) {
  const response = await fetch(apiUrl(`/goals/${goalId}/health`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/health-snapshots`), {
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

export async function enqueueHealthSnapshotReport(
  token: string,
  goalId: string,
  payload: { reportDate?: string } = {}
) {
  return enqueueGoalReport(token, goalId, {
    ...payload,
    type: "HEALTH_SNAPSHOT"
  });
}

export async function enqueueGoalReport(
  token: string,
  goalId: string,
  payload: { type: GoalReportType; reportDate?: string | null }
) {
  const response = await fetch(
    apiUrl(`/goals/${goalId}/reports/enqueue`),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await parseJson<GoalReportQueueResult>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "报告任务入队失败"));
  }

  return data as GoalReportQueueResult;
}

export async function fetchGoalHealthTrend(
  token: string,
  goalId: string,
  payload: {
    type?: Extract<GoalReportType, "WEEKLY_TREND" | "MONTHLY_TREND">;
    reportDate?: string | null;
  } = {}
) {
  const response = await fetch(apiUrl(`/goals/${goalId}/health-trends`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<HealthTrendReport>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "健康趋势报告加载失败"));
  }

  return data as HealthTrendReport;
}

export async function generateGoalReportArtifact(
  token: string,
  goalId: string,
  payload: {
    type: Extract<GoalReportType, "WEEKLY_TREND" | "MONTHLY_TREND">;
    reportDate?: string | null;
  }
) {
  const response = await fetch(apiUrl(`/goals/${goalId}/report-artifacts`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await parseJson<{
    report: HealthTrendReport;
    artifact: ReportArtifact;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "趋势报告生成失败"));
  }

  return data as { report: HealthTrendReport; artifact: ReportArtifact };
}

export async function fetchGoalReportArtifacts(token: string, goalId: string) {
  const response = await fetch(apiUrl(`/goals/${goalId}/report-artifacts`), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const data = await parseJson<{ goalId: string; artifacts: ReportArtifact[] }>(
    response
  );

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "趋势报告列表加载失败"));
  }

  return data as { goalId: string; artifacts: ReportArtifact[] };
}

export async function downloadGoalReportArtifact(
  token: string,
  goalId: string,
  artifactId: string
) {
  const response = await fetch(
    apiUrl(`/goals/${goalId}/report-artifacts/${artifactId}/download`),
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  const data = await parseJson<{
    artifact: ReportArtifact;
    download: {
      filename: string;
      contentType: string;
      encoding: "utf-8";
      content: string;
    };
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "趋势报告下载失败"));
  }

  return data as {
    artifact: ReportArtifact;
    download: {
      filename: string;
      contentType: string;
      encoding: "utf-8";
      content: string;
    };
  };
}

export async function fetchAiJob(token: string, jobId: string) {
  const response = await fetch(apiUrl(`/ai-jobs/${jobId}`), {
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

export async function cancelAiJob(
  token: string,
  jobId: string,
  payload: { reason?: string } = {}
) {
  const response = await fetch(apiUrl(`/ai-jobs/${jobId}/cancel`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{
    job: AiJob;
    cancelled: boolean;
    reason?: string;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "AI 任务取消失败"));
  }

  return data as { job: AiJob; cancelled: boolean; reason?: string };
}

export async function settleGoal(token: string, goalId: string) {
  const response = await fetch(apiUrl(`/goals/${goalId}/settle`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/failure-report`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/restart`), {
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
  const response = await fetch(apiUrl("/notifications/preferences"), {
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
    silentDays?: number[];
    examSprintDays?: number;
  }
) {
  const response = await fetch(apiUrl("/notifications/preferences"), {
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
  const response = await fetch(apiUrl("/notifications/wechat-binding"), {
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
  const response = await fetch(apiUrl("/notifications/wechat-binding"), {
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
  const response = await fetch(apiUrl("/notifications/wechat-binding"), {
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
  const response = await fetch(apiUrl("/notifications/email-logs"), {
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
  const response = await fetch(apiUrl("/notifications/email-logs/preview"), {
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
  const response = await fetch(apiUrl("/notifications/email-logs/enqueue-due"), {
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
    apiUrl("/notifications/email-logs/process-queue"),
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
  const response = await fetch(apiUrl("/notifications/email-logs/retry-failed"), {
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
  const response = await fetch(apiUrl("/admin/overview"), {
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
  const url = apiSearchUrl("/admin/users");

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

export async function fetchAdminGoals(
  token: string,
  filters: AdminGoalFilters = {}
) {
  const url = apiSearchUrl("/admin/goals");

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
    goals: AdminGoal[];
    total: number;
    filters: AdminGoalFilters;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台目标列表加载失败"));
  }

  return data as {
    goals: AdminGoal[];
    total: number;
    filters: AdminGoalFilters;
  };
}

export async function fetchAdminAiJobs(
  token: string,
  filters: AdminAiJobFilters = {}
) {
  const url = apiSearchUrl("/admin/ai-jobs");

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
    jobs: AdminAiJob[];
    total: number;
    filters: AdminAiJobFilters;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台 AI 任务加载失败"));
  }

  return data as {
    jobs: AdminAiJob[];
    total: number;
    filters: AdminAiJobFilters;
  };
}

export async function retryAdminAiJob(
  token: string,
  jobId: string,
  payload: { reason: string }
) {
  const response = await fetch(apiUrl(`/admin/ai-jobs/${jobId}/retry`), {
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

export async function fetchAdminEmailLogs(
  token: string,
  filters: AdminEmailLogFilters = {}
) {
  const url = apiSearchUrl("/admin/email-logs");

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
    logs: AdminEmailLog[];
    total: number;
    filters: AdminEmailLogFilters;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "后台邮件日志加载失败"));
  }

  return data as {
    logs: AdminEmailLog[];
    total: number;
    filters: AdminEmailLogFilters;
  };
}

export async function fetchAdminUploadAssets(token: string) {
  return fetchAdminCollection<{ assets: AdminUploadAsset[]; total: number }>(token, "upload-assets", "后台上传资产加载失败");
}

export async function fetchAdminPaymentEvents(token: string) {
  return fetchAdminCollection<{ events: AdminPaymentEvent[]; total: number }>(token, "payment-events", "后台支付事件加载失败");
}

export async function fetchAdminMembershipAudits(token: string) {
  return fetchAdminCollection<{ audits: AdminMembershipAudit[]; total: number }>(token, "membership-audits", "后台会员审计加载失败");
}

export async function retryAdminEmailLog(token: string, logId: string, reason: string) {
  const response = await fetch(apiUrl(`/admin/email-logs/${logId}/retry`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
  const data = await parseJson<{ log: AdminEmailLog }>(response);
  if (!response.ok) throw new Error(getErrorMessage(data, "后台提醒重试失败"));
  return data as { log: AdminEmailLog };
}

export async function runAdminNotificationScheduler(
  token: string,
  payload: { now?: string; reason: string }
) {
  const response = await fetch(apiUrl("/admin/notifications/scheduler/run"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await parseJson<{
    schedulerRunId: string;
    usersScanned: number;
    logsQueued: number;
    failures: number;
  }>(response);
  if (!response.ok) throw new Error(getErrorMessage(data, "提醒补偿调度失败"));
  return data as {
    schedulerRunId: string;
    usersScanned: number;
    logsQueued: number;
    failures: number;
  };
}

async function fetchAdminCollection<T>(token: string, path: string, fallback: string) {
  const response = await fetch(apiUrl(`/admin/${path}`), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await parseJson<T>(response);
  if (!response.ok) throw new Error(getErrorMessage(data, fallback));
  return data as T;
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
  const response = await fetch(apiUrl(`/admin/users/${userId}/membership`), {
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
  const url = apiSearchUrl(`/admin/users/${userId}/raw-content`);
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
  const response = await fetch(apiUrl("/admin/audit-logs"), {
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
  const response = await fetch(apiUrl("/admin/system-configs"), {
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
  const response = await fetch(apiUrl("/admin/system-configs"), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/rescue-task`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await parseJson<{
    goalId: string;
    goalTitle: string;
    deviation: DeviationSignal;
    rescueTask: RescueTask | null;
    job?: AiJob;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "救援任务生成失败"));
  }

  return data as {
    goalId: string;
    goalTitle: string;
    deviation: DeviationSignal;
    rescueTask: RescueTask | null;
    job?: AiJob;
  };
}

export async function fetchRewardBoard(token: string, goalId: string) {
  const response = await fetch(apiUrl(`/goals/${goalId}/rewards`), {
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
  const response = await fetch(apiUrl(`/goals/${goalId}/rewards`), {
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
    apiUrl(`/goals/${goalId}/rewards/${cardId}`),
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
    apiUrl(`/goals/${goalId}/rewards/${cardId}`),
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
  const url = apiSearchUrl("/daily-tasks/today");

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
    evidenceFiles?: EvidenceFile[] | string;
    evidenceLinks?: string[] | string;
    studyMood?: string;
    difficultyLevel?: string;
  }
) {
  const response = await fetch(apiUrl(`/daily-tasks/${taskId}/complete`), {
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
    apiUrl(`/daily-tasks/checkins/${checkinId}/appeal`),
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
  const url = apiSearchUrl("/daily-tasks/activity");
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
  const url = apiSearchUrl("/daily-tasks/timeline");

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

export async function fetchGrowthEvents(
  token: string,
  filters: {
    goalId?: string;
    type?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const url = apiSearchUrl("/growth-events");

  if (filters.goalId) url.searchParams.set("goalId", filters.goalId);
  if (filters.type) url.searchParams.set("type", filters.type);
  if (filters.from) url.searchParams.set("from", filters.from);
  if (filters.to) url.searchParams.set("to", filters.to);
  if (filters.page) url.searchParams.set("page", String(filters.page));
  if (filters.pageSize) url.searchParams.set("pageSize", String(filters.pageSize));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const data = await parseJson<{
    events: GrowthEvent[];
    total: number;
    page: number;
    pageSize: number;
  }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "统一成长事件加载失败"));
  }

  return data as {
    events: GrowthEvent[];
    total: number;
    page: number;
    pageSize: number;
  };
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

import { FormEvent, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Download,
  Gift,
  History,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCircle
} from "lucide-react";
import { AuthPanel } from "./AuthPanel";
import {
  AuthResponse,
  ActivityDay,
  AdminAiJob,
  AdminAiJobFilters,
  AdminAuditLog,
  AdminEmailLog,
  AdminEmailLogFilters,
  AdminGoal,
  AdminGoalFilters,
  AdminOverview,
  AdminRawContent,
  AdminSystemConfig,
  AdminUser,
  AdminUserFilters,
  AiJob,
  DataExportFormat,
  DataExportResponse,
  DataExportScope,
  EmailLog,
  FailureReport,
  Goal,
  GoalHealth,
  GoalPlan,
  NotificationChannel,
  NotificationPreference,
  RewardBoard,
  RewardCard,
  ReminderType,
  RescueTask,
  ScoreAppeal,
  TaskCheckin,
  TimelineDay,
  TimelineItem,
  TodayDailyTask,
  WechatBinding,
  appealCheckinScore,
  bindWechat,
  confirmGoalPlan,
  completeDailyTask,
  createPreviewEmailLog,
  createRewardCard,
  createGoal,
  deleteCurrentAccount,
  deleteGoal,
  deleteRewardCard,
  enqueueDueEmailLogs,
  exportCurrentAccountData,
  fetchAdminAiJobs,
  fetchAdminAuditLogs,
  fetchAdminEmailLogs,
  fetchAdminGoals,
  fetchAdminOverview,
  fetchAdminRawContent,
  fetchAdminSystemConfigs,
  fetchAdminUsers,
  fetchAiJob,
  fetchCurrentUser,
  fetchEmailLogs,
  fetchFailureReport,
  fetchGoalPlan,
  fetchGoalHealth,
  fetchNotificationPreference,
  fetchRewardBoard,
  fetchTaskActivity,
  fetchTaskTimeline,
  fetchTodayTasks,
  fetchWechatBinding,
  generateGoalPlan,
  generateRescueTask,
  listGoals,
  processQueuedEmailLogs,
  retryAdminAiJob,
  requestGoalReplan,
  restartGoal,
  retryFailedEmailLogs,
  settleGoal,
  unbindWechat,
  updateAdminMembership,
  updateNotificationPreference,
  updateRewardCard,
  upsertAdminSystemConfig
} from "./api";

type PageId =
  | "create"
  | "goals"
  | "plan"
  | "today"
  | "heatmap"
  | "timeline"
  | "rewards"
  | "failure"
  | "account"
  | "admin";

interface NavItem {
  id: PageId;
  label: string;
  description: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  {
    id: "create",
    label: "创建目标",
    description: "Goal intake",
    icon: Sparkles
  },
  {
    id: "goals",
    label: "目标列表",
    description: "Current goal",
    icon: ShieldCheck
  },
  {
    id: "plan",
    label: "计划确认",
    description: "Plan review",
    icon: CheckCircle2
  },
  {
    id: "today",
    label: "今日任务",
    description: "Daily work",
    icon: CalendarCheck
  },
  {
    id: "heatmap",
    label: "成长热力图",
    description: "Progress map",
    icon: LineChart
  },
  {
    id: "timeline",
    label: "成长时间线",
    description: "Growth story",
    icon: History
  },
  {
    id: "rewards",
    label: "奖励愿景板",
    description: "Reward board",
    icon: Gift
  },
  {
    id: "failure",
    label: "失败复盘",
    description: "Failure report",
    icon: ShieldCheck
  },
  {
    id: "account",
    label: "账号",
    description: "Account",
    icon: UserCircle
  },
  {
    id: "admin",
    label: "后台管理",
    description: "Operations",
    icon: ShieldCheck
  }
];

const dataExportScopeOptions: Array<{
  code: DataExportScope;
  label: string;
}> = [
  { code: "profile", label: "账号资料" },
  { code: "membership", label: "会员状态" },
  { code: "goals", label: "目标" },
  { code: "plans", label: "计划" },
  { code: "milestones", label: "里程碑" },
  { code: "dailyTasks", label: "每日任务" },
  { code: "checkins", label: "打卡记录" },
  { code: "aiScores", label: "AI 评分" },
  { code: "scoreAppeals", label: "评分申诉" },
  { code: "deviationEvents", label: "偏差事件" },
  { code: "healthSnapshots", label: "健康趋势" },
  { code: "rewardCards", label: "奖励愿景板" },
  { code: "failureReports", label: "失败复盘" },
  { code: "aiJobs", label: "AI 任务" },
  { code: "notificationPreference", label: "提醒偏好" },
  { code: "emailLogs", label: "提醒日志" },
  { code: "wechatBinding", label: "微信绑定" },
  { code: "uploadAssets", label: "上传证据" },
  { code: "adminProfile", label: "后台身份" },
  { code: "auditLogs", label: "审计日志" }
];

const defaultDataExportScopes: DataExportScope[] = [
  "profile",
  "membership",
  "goals",
  "plans",
  "dailyTasks",
  "checkins",
  "aiScores",
  "deviationEvents",
  "healthSnapshots",
  "failureReports"
];

const setupFields = [
  "目标描述",
  "开始/结束日期",
  "每日投入",
  "当前基础",
  "容错次数",
  "奖励"
];

const goalStatusLabels: Record<string, string> = {
  DRAFT: "草稿",
  GENERATING_PLAN: "生成计划中",
  GENERATION_FAILED: "计划生成失败",
  WAITING_CONFIRMATION: "待确认计划",
  ACTIVE: "执行中",
  AT_RISK: "有风险",
  REPLANNING: "重新规划中",
  COMPLETED: "已完成",
  FAILED: "已失败"
};

const riskLevelLabels: Record<string, string> = {
  stable: "稳定",
  warning: "预警",
  danger: "高风险"
};

const taskStatusLabels: Record<string, string> = {
  PENDING: "待完成",
  DONE: "已完成",
  PREVIEW: "预览"
};

const rewardCardTypeLabels: Record<string, string> = {
  TEXT: "文字",
  IMAGE: "图片",
  LINK: "外链"
};

const rewardSourceLabels: Record<string, string> = {
  FINAL_REWARD: "最终奖励",
  MILESTONE_REWARD: "阶段奖励",
  CUSTOM: "自定义"
};

const aiJobTypeLabels: Record<string, string> = {
  GOAL_PLAN_GENERATION: "计划生成",
  GOAL_PLAN_REPLAN: "计划调整",
  CHECKIN_SCORING: "打卡评分",
  CHECKIN_SCORE_APPEAL: "评分复评",
  SCORE_CHECKIN: "打卡评分",
  SEND_EMAIL: "邮件发送"
};

const aiJobStatusLabels: Record<string, string> = {
  PENDING: "排队中",
  QUEUED: "排队中",
  RUNNING: "处理中",
  RETRYING: "重试中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消"
};
const activeAiJobStatuses = new Set(["PENDING", "QUEUED", "RUNNING", "RETRYING"]);
const terminalAiJobStatuses = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

const studyTaskTypeLabels: Record<string, string> = {
  READING: "阅读",
  MEMORIZATION: "背诵",
  PRACTICE: "刷题",
  REVIEW: "复习",
  MOCK_EXAM: "模考",
  WRITING: "写作",
  LISTENING: "听力",
  VOCABULARY: "词汇",
  ERROR_BOOK: "错题",
  OTHER: "其他"
};

const journeySteps = [
  {
    title: "AI 计划",
    text: "阶段里程碑、每周计划、每日任务。",
    icon: Sparkles
  },
  {
    title: "每日打卡",
    text: "文本复盘与完成内容提交。",
    icon: CalendarCheck
  },
  {
    title: "偏差校正",
    text: "低分、断签、延期触发提醒。",
    icon: ShieldCheck
  },
  {
    title: "成长记录",
    text: "热力图、健康报告、时间线。",
    icon: LineChart
  }
];

const contributionWeekdayLabels = [
  { label: "Mon", row: 1 },
  { label: "Wed", row: 3 },
  { label: "Fri", row: 5 }
];

const monthShortLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const dayMs = 24 * 60 * 60 * 1000;

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(year, month - 1, day);
}

function getYearContributionMap(year: number, activityDays: ActivityDay[]) {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const leadingDays = (yearStart.getDay() + 6) % 7;
  const trailingDays = 6 - ((yearEnd.getDay() + 6) % 7);
  const firstCellDate = new Date(year, 0, 1 - leadingDays);
  const lastCellDate = new Date(year, 11, 31 + trailingDays);
  const activityByDate = new Map(
    activityDays.map((day) => [day.date, day])
  );
  const totalDays = Math.round(
    (lastCellDate.getTime() - firstCellDate.getTime()) / dayMs
  ) + 1;
  const cells = Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(firstCellDate);
    date.setDate(firstCellDate.getDate() + index);
    const isOutsideYear = date.getFullYear() !== year;
    const dateKey = toDateKey(date);
    const level = isOutsideYear ? 0 : activityByDate.get(dateKey)?.level ?? 0;

    return {
      date,
      dateKey,
      isOutsideYear,
      level
    };
  });
  const weekCount = Math.ceil(totalDays / 7);
  const monthLabels = monthShortLabels.map((label, monthIndex) => {
    const monthStart = new Date(year, monthIndex, 1);
    const dayOffset = Math.round(
      (monthStart.getTime() - firstCellDate.getTime()) / dayMs
    );

    return {
      label,
      column: Math.floor(dayOffset / 7) + 1
    };
  });

  return {
    cells,
    monthLabels,
    weekCount
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatActivityDate(dateKey: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(parseDateKey(dateKey));
}

function formatActivityMonth(dateKey: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  }).format(parseDateKey(dateKey));
}

function getStudyTaskMeta(task: object) {
  const record = task as Record<string, unknown>;
  const studyTaskType =
    typeof record.studyTaskType === "string" ? record.studyTaskType : "";
  const subject = typeof record.subject === "string" ? record.subject : "";
  const chapterRef = typeof record.chapterRef === "string" ? record.chapterRef : "";
  const questionCount =
    typeof record.questionCount === "number" ? record.questionCount : null;
  const targetAccuracy =
    typeof record.targetAccuracy === "number" ? record.targetAccuracy : null;
  const evidenceRequired = record.evidenceRequired === true;

  return [
    studyTaskType ? studyTaskTypeLabels[studyTaskType] ?? studyTaskType : "",
    subject,
    chapterRef,
    questionCount ? `${questionCount} 题` : "",
    targetAccuracy ? `目标正确率 ${targetAccuracy}%` : "",
    evidenceRequired ? "需证据" : ""
  ].filter(Boolean);
}

function splitFormList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getTimelineBadge(item: TimelineItem) {
  if (item.kind === "DEVIATION") {
    return riskLevelLabels[item.rescueRiskLevel ?? "stable"] ?? "偏差";
  }

  return item.aiScore ? `AI ${item.aiScore.totalScore}` : "待评分";
}

const healthMetrics = [
  { label: "完成率", value: "0%", tone: "neutral" },
  { label: "平均分", value: "-", tone: "neutral" },
  { label: "容错剩余", value: "3", tone: "good" },
  { label: "连续天数", value: "0", tone: "neutral" }
];

const plannedTasks = [
  {
    id: "preview-1",
    goalTitle: "计划待生成",
    weeklyPlanTitle: null,
    title: "阅读核心资料",
    description: "AI 计划生成并确认后，这里会显示当天真实任务。",
    plannedMinutes: 45,
    taskType: "NORMAL",
    rescueReason: null,
    status: "PREVIEW",
    latestCheckin: null
  },
  {
    id: "preview-2",
    goalTitle: "计划待生成",
    weeklyPlanTitle: null,
    title: "输出学习笔记",
    description: "完成按钮会在真实任务生成后启用。",
    plannedMinutes: 20,
    taskType: "NORMAL",
    rescueReason: null,
    status: "PREVIEW",
    latestCheckin: null
  },
  {
    id: "preview-3",
    goalTitle: "计划待生成",
    weeklyPlanTitle: null,
    title: "提交今日复盘",
    description: "完成后会写入 checkin 并更新热力图。",
    plannedMinutes: 10,
    taskType: "NORMAL",
    rescueReason: null,
    status: "PREVIEW",
    latestCheckin: null
  }
];

const timelineItems = [
  { title: "目标草稿", detail: "等待 AI 计划生成" },
  { title: "阶段里程碑", detail: "待创建" },
  { title: "每日任务", detail: "待排期" },
  { title: "健康报告", detail: "暂无评分数据" }
];

const categoryExamples: Record<
  string,
  {
    title: string;
    description: string;
    dailyTimeBudgetMinutes: string;
    currentBaseline: string;
    constraints: string;
    finalReward: string;
  }
> = {
  study: {
    title: "90 天完成 React 项目",
    description: "系统学习 React，并完成一个可展示的项目",
    dailyTimeBudgetMinutes: "60",
    currentBaseline: "了解基础 HTML/CSS",
    constraints: "工作日晚上 1 小时",
    finalReward: "买一把喜欢的键盘"
  },
  career: {
    title: "60 天完成产品经理面试准备",
    description: "梳理项目经历、补齐业务分析能力，并完成 3 轮模拟面试",
    dailyTimeBudgetMinutes: "75",
    currentBaseline: "有 2 年项目协作经验",
    constraints: "工作日通勤后复盘，周末集中整理作品集",
    finalReward: "安排一次短途旅行"
  },
  fitness: {
    title: "12 周养成稳定跑步习惯",
    description: "从低强度训练开始，逐步提升到连续完成 5 公里",
    dailyTimeBudgetMinutes: "45",
    currentBaseline: "每周偶尔散步，缺少规律训练",
    constraints: "膝盖不适时改成快走或拉伸",
    finalReward: "买一双新的跑鞋"
  },
  habit: {
    title: "30 天建立早睡早起习惯",
    description: "固定睡前流程，减少熬夜，稳定在 23:30 前入睡",
    dailyTimeBudgetMinutes: "20",
    currentBaseline: "经常 1 点后睡，早晨起床困难",
    constraints: "晚上 22:30 后不再刷短视频",
    finalReward: "周末安排一次舒服的早餐"
  },
  custom: {
    title: "30 天完成房间整理计划",
    description: "整理卧室、书桌和文件，把空间恢复到易维护的状态",
    dailyTimeBudgetMinutes: "40",
    currentBaseline: "物品分类混乱，缺少固定收纳位置",
    constraints: "每天只处理一个小区域，避免一次性整理过载",
    finalReward: "买一件喜欢的家居小物"
  }
};

export function App() {
  const [activePage, setActivePage] = useState<PageId>("create");
  const [isLabelNavCollapsed, setIsLabelNavCollapsed] = useState(false);
  const [heatmapYear, setHeatmapYear] = useState(() => new Date().getFullYear());
  const [selectedHeatmapDate, setSelectedHeatmapDate] = useState(() =>
    toDateKey(new Date())
  );
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [createdGoal, setCreatedGoal] = useState<Goal | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<GoalPlan | null>(null);
  const [goalForm, setGoalForm] = useState({
    title: "",
    description: "",
    category: "study",
    startDate: "",
    endDate: "",
    dailyTimeBudgetMinutes: "",
    toleranceDaysAllowed: "3",
    currentBaseline: "",
    constraints: "",
    finalReward: ""
  });
  const [replanForm, setReplanForm] = useState({
    adjustmentReason: "",
    dailyTimeBudgetMinutes: "",
    constraints: "",
    currentBaseline: ""
  });
  const [goalMessage, setGoalMessage] = useState("登录后可保存目标草稿。");
  const [planMessage, setPlanMessage] = useState("保存目标后可生成 AI 计划。");
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isConfirmingPlan, setIsConfirmingPlan] = useState(false);
  const [isRequestingReplan, setIsRequestingReplan] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [todayTasks, setTodayTasks] = useState<TodayDailyTask[]>([]);
  const [activityDays, setActivityDays] = useState<ActivityDay[]>([]);
  const [timelineDays, setTimelineDays] = useState<TimelineDay[]>([]);
  const [goalHealth, setGoalHealth] = useState<GoalHealth | null>(null);
  const [rescueTask, setRescueTask] = useState<RescueTask | null>(null);
  const [rewardBoard, setRewardBoard] = useState<RewardBoard | null>(null);
  const [failureReport, setFailureReport] = useState<FailureReport | null>(null);
  const [notificationPreference, setNotificationPreference] =
    useState<NotificationPreference | null>(null);
  const [wechatBinding, setWechatBinding] = useState<WechatBinding | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminUserTotal, setAdminUserTotal] = useState(0);
  const [adminGoals, setAdminGoals] = useState<AdminGoal[]>([]);
  const [adminGoalTotal, setAdminGoalTotal] = useState(0);
  const [adminAiJobs, setAdminAiJobs] = useState<AdminAiJob[]>([]);
  const [adminAiJobTotal, setAdminAiJobTotal] = useState(0);
  const [adminEmailLogs, setAdminEmailLogs] = useState<AdminEmailLog[]>([]);
  const [adminEmailLogTotal, setAdminEmailLogTotal] = useState(0);
  const [adminAuditLogs, setAdminAuditLogs] = useState<AdminAuditLog[]>([]);
  const [adminSystemConfigs, setAdminSystemConfigs] = useState<
    AdminSystemConfig[]
  >([]);
  const [adminRawContent, setAdminRawContent] =
    useState<AdminRawContent | null>(null);
  const [dailyTaskMessage, setDailyTaskMessage] = useState("登录后可查看今日任务。");
  const [timelineMessage, setTimelineMessage] = useState("登录后可查看成长时间线。");
  const [rewardMessage, setRewardMessage] = useState("选择目标后可维护奖励愿景板。");
  const [failureMessage, setFailureMessage] = useState("选择失败目标后可查看失败复盘。");
  const [notificationMessage, setNotificationMessage] =
    useState("登录后可设置邮件提醒。");
  const [adminMessage, setAdminMessage] = useState("管理员账号登录后可查看后台。");
  const [isLoadingDailyTasks, setIsLoadingDailyTasks] = useState(false);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
  const [isLoadingRewards, setIsLoadingRewards] = useState(false);
  const [isLoadingFailureReport, setIsLoadingFailureReport] = useState(false);
  const [isSettlingGoal, setIsSettlingGoal] = useState(false);
  const [isRestartingGoal, setIsRestartingGoal] = useState(false);
  const [isSavingNotificationPreference, setIsSavingNotificationPreference] =
    useState(false);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [isSavingAdminConfig, setIsSavingAdminConfig] = useState(false);
  const [adminMembershipUpdatingUserId, setAdminMembershipUpdatingUserId] =
    useState<string | null>(null);
  const [adminRetryingAiJobId, setAdminRetryingAiJobId] = useState<string | null>(null);
  const [isGeneratingRescueTask, setIsGeneratingRescueTask] = useState(false);
  const [selectedTimelineDate, setSelectedTimelineDate] = useState(() =>
    toDateKey(new Date())
  );
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completionTask, setCompletionTask] = useState<TodayDailyTask | null>(null);
  const [completionForm, setCompletionForm] = useState({
    investedMinutes: "",
    completedContent: "",
    blockers: "",
    tomorrowAdjustment: "",
    completedSubtasks: "",
    actualQuestionCount: "",
    correctQuestionCount: "",
    evidenceFiles: "",
    evidenceLinks: "",
    studyMood: "",
    difficultyLevel: ""
  });
  const [appealForm, setAppealForm] = useState({
    reason: "",
    addedFacts: ""
  });
  const [appealResult, setAppealResult] = useState<ScoreAppeal | null>(null);
  const [appealMessage, setAppealMessage] = useState("");
  const [isSubmittingAppeal, setIsSubmittingAppeal] = useState(false);
  const [rewardForm, setRewardForm] = useState({
    title: "",
    description: "",
    cardType: "TEXT" as RewardCard["cardType"],
    imageUrl: "",
    linkUrl: ""
  });
  const [wechatForm, setWechatForm] = useState({
    openId: "",
    unionId: "",
    nickname: ""
  });
  const [dataExportForm, setDataExportForm] = useState<{
    format: DataExportFormat;
    fullExport: boolean;
    scopes: DataExportScope[];
  }>({
    format: "JSON",
    fullExport: false,
    scopes: defaultDataExportScopes
  });
  const [dataExportResult, setDataExportResult] =
    useState<DataExportResponse | null>(null);
  const [dataExportMessage, setDataExportMessage] =
    useState("选择范围后可导出当前账号数据。");
  const [isExportingData, setIsExportingData] = useState(false);
  const [adminRawForm, setAdminRawForm] = useState({
    userId: "",
    reason: ""
  });
  const [adminUserFilters, setAdminUserFilters] = useState<AdminUserFilters>({
    query: "",
    status: "",
    plan: "",
    adminRole: ""
  });
  const [adminGoalFilters, setAdminGoalFilters] = useState<AdminGoalFilters>({
    query: "",
    status: "",
    category: ""
  });
  const [adminAiJobFilters, setAdminAiJobFilters] =
    useState<AdminAiJobFilters>({
      query: "",
      status: "",
      type: ""
    });
  const [adminEmailLogFilters, setAdminEmailLogFilters] =
    useState<AdminEmailLogFilters>({
      query: "",
      status: "",
      type: "",
      channel: ""
    });
  const [adminConfigForm, setAdminConfigForm] = useState({
    key: "mvp.feature_flag",
    value: "{\n  \"enabled\": true\n}",
    description: "MVP 后台配置",
    reason: "后台配置管理"
  });
  const [completionResult, setCompletionResult] = useState<{
    task: TodayDailyTask;
    checkin: TaskCheckin;
    job: AiJob;
  } | null>(null);
  const [trackedAiJob, setTrackedAiJob] = useState<AiJob | null>(null);
  const [aiJobMessage, setAiJobMessage] =
    useState("完成 AI 操作后可查看最近任务状态。");
  const [isRefreshingAiJob, setIsRefreshingAiJob] = useState(false);

  const isAdminUser = Boolean(session?.user.adminRole);
  const visibleNavItems = isAdminUser
    ? navItems
    : navItems.filter((item) => item.id !== "admin");
  const activeNavItem =
    visibleNavItems.find((item) => item.id === activePage) ??
    visibleNavItems.find((item) => item.id === "account") ??
    visibleNavItems[0];
  const selectedGoal =
    goals.find((goal) => goal.id === selectedGoalId) ??
    (createdGoal?.id === selectedGoalId ? createdGoal : null);
  const completionJobStatus =
    completionResult && trackedAiJob?.id === completionResult.job.id
      ? trackedAiJob.status
      : completionResult?.job.status;
  const selectedGeneratedPlan =
    generatedPlan && generatedPlan.goalId === selectedGoalId ? generatedPlan : null;
  const contributionMap = getYearContributionMap(heatmapYear, activityDays);
  const heatmapYearOptions = [new Date().getFullYear(), new Date().getFullYear() - 1];
  const selectedActivityDay = activityDays.find(
    (day) => day.date === selectedHeatmapDate
  );
  const selectedHeatmapTimelineDay = timelineDays.find(
    (day) => day.date === selectedHeatmapDate
  );
  const selectedTimelineDay = timelineDays.find(
    (day) => day.date === selectedTimelineDate
  );
  const recentTimelineItems = timelineDays
    .flatMap((day) => day.items)
    .slice(0, 3);
  const rewardCardsForGoal = rewardBoard?.cards ?? [];
  const customRewardCount = rewardCardsForGoal.filter(
    (card) => card.sourceType === "CUSTOM"
  ).length;
  const customRewardLimit =
    session?.user.membership?.plan === "PRO"
      ? rewardBoard?.limits.proCustomCards
      : rewardBoard?.limits.freeCustomCards;
  const selectedHeatmapTasks = selectedActivityDay?.tasks ?? [];
  const selectedHeatmapTimelineItems = selectedHeatmapTimelineDay?.items ?? [];
  const selectedHeatmapMinutes =
    selectedHeatmapTimelineDay?.investedMinutes ??
    selectedActivityDay?.investedMinutes ??
    0;
  const selectedHeatmapAverageScore =
    selectedHeatmapTimelineDay?.averageScore ??
    selectedActivityDay?.averageScore ??
    null;
  const selectedHeatmapLevel = selectedActivityDay?.level ?? 0;
  const selectedHeatmapHealthScore = selectedActivityDay?.healthScore ?? 0;
  const selectedHeatmapCompletionRate = selectedActivityDay?.completionRate ?? 0;
  const heatmapContributionCount = activityDays.reduce(
    (total, day) => total + day.completedTaskCount,
    0
  );
  const currentGoalId =
    selectedGoalId ??
    (createdGoal?.status === "ACTIVE" || createdGoal?.status === "AT_RISK"
      ? createdGoal.id
      : todayTasks[0]?.goalId);
  const healthPanelMetrics = goalHealth
    ? [
        {
          label: "今日完成",
          value: `${goalHealth.todayCompletionRate}%`,
          tone: goalHealth.todayCompletionRate >= 80 ? "good" : "neutral"
        },
        {
          label: "本周完成",
          value: `${goalHealth.weekCompletionRate}%`,
          tone: goalHealth.weekCompletionRate >= 60 ? "good" : "neutral"
        },
        {
          label: "连续天数",
          value: `${goalHealth.streakDays}`,
          tone: goalHealth.streakDays > 0 ? "good" : "neutral"
        },
        {
          label: "容错剩余",
          value: `${goalHealth.toleranceRemaining}`,
          tone: goalHealth.toleranceRemaining > 1 ? "good" : "neutral"
        },
        {
          label: "近7天救援",
          value: `${goalHealth.rescueSuccessCount7d}`,
          tone: goalHealth.rescueSuccessCount7d > 0 ? "good" : "neutral"
        },
        {
          label: "救援完成",
          value: `${goalHealth.rescueTaskCompletionRate}%`,
          tone: goalHealth.rescueTaskCompletionRate >= 80 ? "good" : "neutral"
        },
        {
          label: "普通完成",
          value: `${goalHealth.normalTaskCompletionRate}%`,
          tone: goalHealth.normalTaskCompletionRate >= 60 ? "good" : "neutral"
        },
        {
          label: "次日恢复",
          value:
            goalHealth.rescueNextDayRecovered === null
              ? "待观察"
              : goalHealth.rescueNextDayRecovered
                ? "是"
                : "否",
          tone: goalHealth.rescueNextDayRecovered ? "good" : "neutral"
        }
      ]
    : healthMetrics;
  const baseVisiblePlannedTasks =
    todayTasks.length > 0
      ? todayTasks
      : selectedGeneratedPlan
        ? selectedGeneratedPlan.weeklyPlans
            .flatMap((weeklyPlan) =>
              weeklyPlan.dailyTasks.map((task) => ({
                task,
                weeklyPlanTitle: weeklyPlan.title
              }))
            )
            .slice(0, 3)
            .map(({ task, weeklyPlanTitle }) => ({
              id: task.id,
              goalTitle: selectedGeneratedPlan.summary,
              weeklyPlanTitle,
              title: task.title,
              description: task.description,
              plannedMinutes: task.plannedMinutes,
              taskType: task.taskType ?? "NORMAL",
              rescueReason: task.rescueReason ?? null,
              status: task.status,
              latestCheckin: null
            }))
        : plannedTasks;
  const visiblePlannedTasks = baseVisiblePlannedTasks;
  const deviationLevel = goalHealth?.deviation.riskLevel ?? "stable";
  const deviationReasons = goalHealth?.deviation.reasons ?? [];
  const todayCompletedCount = todayTasks.filter((task) => task.status === "DONE").length;
  const todayTaskCount = todayTasks.length;
  const selectedPlanTaskCount =
    selectedGeneratedPlan?.weeklyPlans.reduce(
      (count, weeklyPlan) => count + weeklyPlan.dailyTasks.length,
      0
    ) ?? 0;
  const planReviewStats = selectedGeneratedPlan
    ? [
        {
          label: "阶段里程碑",
          value: `${selectedGeneratedPlan.milestones.length} 个`
        },
        {
          label: "每周计划",
          value: `${selectedGeneratedPlan.weeklyPlans.length} 周`
        },
        {
          label: "每日任务",
          value: `${selectedPlanTaskCount} 个`
        },
        {
          label: "计划状态",
          value: selectedGeneratedPlan.isActive ? "已确认" : "待确认"
        }
      ]
    : [];
  const selectedGoalStatus =
    selectedGoal ? goalStatusLabels[selectedGoal.status] ?? selectedGoal.status : "待选择";
  const accountQuotaMetrics = session
    ? [
        ["进行中目标", session.user.quota.activeGoals],
        ["今日 AI 次数", session.user.quota.aiJobsToday],
        ["本周重规划", session.user.quota.replansThisWeek],
        ["本周申诉", session.user.quota.scoreAppealsThisWeek]
      ] as const
    : [];
  const dashboardAction = getDashboardAction();
  const goalPlaceholders =
    categoryExamples[goalForm.category] ?? categoryExamples.custom;

  function handleAuthenticated(response: AuthResponse) {
    setSession(response);
    setActivePage("create");
    setGoalMessage("已登录，可以创建目标草稿。");
  }

  useEffect(() => {
    let isMounted = true;
    const token = localStorage.getItem("goalmate.session");

    if (!token) {
      return () => {
        isMounted = false;
      };
    }

    fetchCurrentUser(token)
      .then((response) => {
        if (!isMounted) {
          return;
        }

        setSession({
          token,
          user: response.user
        });
        setGoalMessage("已恢复登录，可以继续创建目标草稿。");
      })
      .catch(() => {
        localStorage.removeItem("goalmate.session");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setGoals([]);
      setSelectedGoalId(null);
      setTodayTasks([]);
      setActivityDays([]);
      setTimelineDays([]);
      setGoalHealth(null);
      setRescueTask(null);
      setRewardBoard(null);
      setFailureReport(null);
      setNotificationPreference(null);
      setWechatBinding(null);
      setEmailLogs([]);
      setDataExportResult(null);
      setAdminOverview(null);
      setAdminUsers([]);
      setAdminUserTotal(0);
      setAdminGoals([]);
      setAdminGoalTotal(0);
      setAdminAiJobs([]);
      setAdminAiJobTotal(0);
      setAdminEmailLogs([]);
      setAdminEmailLogTotal(0);
      setAdminAuditLogs([]);
      setAdminSystemConfigs([]);
      setAdminRawContent(null);
      setDailyTaskMessage("登录后可查看今日任务。");
      setTimelineMessage("登录后可查看成长时间线。");
      setRewardMessage("登录后可维护奖励愿景板。");
      setFailureMessage("登录后可查看失败复盘。");
      setNotificationMessage("登录后可设置邮件提醒。");
      setDataExportMessage("选择范围后可导出当前账号数据。");
      setAdminMessage("管理员账号登录后可查看后台。");
      return;
    }

    void refreshGoals(session.token);
  }, [session]);

  useEffect(() => {
    setRescueTask(null);
    setRewardBoard(null);
    setFailureReport(null);
  }, [selectedGoalId]);

  useEffect(() => {
    if (!session || !selectedGoalId) {
      return;
    }

    if (activePage === "rewards") {
      void loadRewardBoard(session.token, selectedGoalId);
    }
  }, [activePage, session, selectedGoalId]);

  useEffect(() => {
    if (!session || !selectedGoalId) {
      return;
    }

    if (activePage === "failure" && selectedGoal?.status === "FAILED") {
      void loadFailureReport(session.token, selectedGoalId);
    }
  }, [activePage, session, selectedGoalId, selectedGoal?.status]);

  useEffect(() => {
    if (!session || activePage !== "account") {
      return;
    }

    void loadNotificationSettings(session.token);
  }, [activePage, session]);

  useEffect(() => {
    if (!session || activePage !== "admin" || !isAdminUser) {
      return;
    }

    void loadAdminDashboard(session.token);
  }, [activePage, session, isAdminUser]);

  useEffect(() => {
    if (activePage === "admin" && !isAdminUser) {
      setActivePage("account");
      setAdminMessage("只有管理员账号可以访问后台管理。");
    }
  }, [activePage, isAdminUser]);

  useEffect(() => {
    if (!session) {
      return;
    }

    void refreshDailyTaskData(session.token, heatmapYear, selectedGoalId ?? undefined);
  }, [session, heatmapYear, selectedGoalId]);

  useEffect(() => {
    if (!session || !selectedGoalId) {
      return;
    }

    const shouldLoadPlan =
      activePage === "plan" ||
      selectedGoal?.status === "WAITING_CONFIRMATION" ||
      selectedGoal?.status === "ACTIVE";

    if (
      shouldLoadPlan &&
      (!selectedGeneratedPlan || selectedGeneratedPlan.goalId !== selectedGoalId)
    ) {
      void loadGoalPlan(session.token, selectedGoalId);
    }
  }, [activePage, session, selectedGoalId, selectedGoal?.status]);

  useEffect(() => {
    if (!session || !trackedAiJob || !activeAiJobStatuses.has(trackedAiJob.status)) {
      return;
    }

    let stopped = false;
    let inFlight = false;

    async function pollTrackedAiJob() {
      if (!session || !trackedAiJob || inFlight) {
        return;
      }

      inFlight = true;

      try {
        const response = await fetchAiJob(session.token, trackedAiJob.id);

        if (stopped) {
          return;
        }

        setTrackedAiJob(response.job);
        setCompletionResult((current) =>
          current?.job.id === response.job.id
            ? {
                ...current,
                job: response.job
              }
            : current
        );

        if (response.job.status !== trackedAiJob.status) {
          const statusLabel =
            aiJobStatusLabels[response.job.status] ?? response.job.status;
          const isTerminal = terminalAiJobStatuses.has(response.job.status);

          setAiJobMessage(
            isTerminal
              ? `AI 任务已结束：${statusLabel}`
              : `AI 任务状态已自动更新：${statusLabel}`
          );
        }

        if (
          response.job.status === "SUCCEEDED" &&
          response.job.goalId &&
          ["GOAL_PLAN_GENERATION", "GOAL_PLAN_REPLAN"].includes(response.job.type)
        ) {
          void refreshGoals(session.token, response.job.goalId);

          if (!selectedGoalId || selectedGoalId === response.job.goalId) {
            void loadGoalPlan(session.token, response.job.goalId);
          }
        }
      } catch (error) {
        if (!stopped) {
          setAiJobMessage(
            error instanceof Error ? error.message : "AI 任务自动轮询失败"
          );
        }
      } finally {
        inFlight = false;
      }
    }

    void pollTrackedAiJob();
    const timer = window.setInterval(pollTrackedAiJob, 4000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [
    session?.token,
    trackedAiJob?.id,
    trackedAiJob?.status,
    trackedAiJob?.type,
    trackedAiJob?.goalId,
    selectedGoalId
  ]);

  async function refreshGoals(token = session?.token, preferredGoalId?: string) {
    if (!token) {
      return;
    }

    try {
      const response = await listGoals(token);
      setGoals(response.goals);

      if (preferredGoalId && response.goals.some((goal) => goal.id === preferredGoalId)) {
        setSelectedGoalId(preferredGoalId);
      } else if (
        !selectedGoalId ||
        !response.goals.some((goal) => goal.id === selectedGoalId)
      ) {
        setSelectedGoalId(getDefaultGoalId(response.goals));
      }
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : "目标列表加载失败");
    }
  }

  function getDefaultGoalId(goalList: Goal[]) {
    return (
      goalList.find((goal) => ["ACTIVE", "AT_RISK"].includes(goal.status))?.id ??
      goalList.find((goal) => goal.status === "WAITING_CONFIRMATION")?.id ??
      goalList[0]?.id ??
      null
    );
  }

  async function loadGoalPlan(token = session?.token, goalId = selectedGoalId) {
    if (!token || !goalId) {
      return;
    }

    setIsLoadingPlan(true);

    try {
      const response = await fetchGoalPlan(token, goalId);

      setGeneratedPlan(response.plan);
      setPlanMessage(
        response.plan.isActive
          ? "计划已确认，可继续执行今日任务。"
          : "计划已加载，请检查后确认。"
      );
    } catch (error) {
      if (activePage === "plan") {
        setPlanMessage(error instanceof Error ? error.message : "计划加载失败");
      }
    } finally {
      setIsLoadingPlan(false);
    }
  }

  function getDashboardAction(): {
    label: string;
    description: string;
    icon: LucideIcon;
    disabled: boolean;
    run: () => void | Promise<void>;
  } {
    if (!selectedGoal) {
      return {
        label: "创建目标",
        description: "先保存一个目标草稿，系统会把它设为当前目标。",
        icon: Sparkles,
        disabled: false,
        run: () => setActivePage("create")
      };
    }

    if (["DRAFT", "GENERATION_FAILED"].includes(selectedGoal.status)) {
      return {
        label: isGeneratingPlan ? "生成中" : "生成 AI 计划",
        description: "把当前目标拆成阶段里程碑、每周计划和每日任务。",
        icon: Sparkles,
        disabled: isGeneratingPlan,
        run: handleGeneratePlan
      };
    }

    if (selectedGoal.status === "WAITING_CONFIRMATION") {
      return {
        label: "查看计划",
        description: "进入计划确认页，检查里程碑、每周节奏和每日任务后再确认。",
        icon: CheckCircle2,
        disabled: false,
        run: () => setActivePage("plan")
      };
    }

    if (["ACTIVE", "AT_RISK", "REPLANNING"].includes(selectedGoal.status)) {
      return {
        label: "去完成今日任务",
        description: "继续推进当前目标，完成后会更新热力图和健康度。",
        icon: CalendarCheck,
        disabled: false,
        run: () => setActivePage("today")
      };
    }

    return {
      label: "查看成长记录",
      description: "回看目标的完成记录、投入时间和成长轨迹。",
      icon: History,
      disabled: false,
      run: () => setActivePage("timeline")
    };
  }

  function openTimelineDate(date: string) {
    setSelectedTimelineDate(date);
    setActivePage("timeline");
  }

  async function refreshDailyTaskData(
    token = session?.token,
    year = heatmapYear,
    goalId = selectedGoalId ?? undefined
  ) {
    if (!token) {
      return;
    }

    setIsLoadingDailyTasks(true);
    setIsLoadingTimeline(true);

    try {
      const [todayResponse, activityResponse, timelineResponse] = await Promise.all([
        fetchTodayTasks(token, goalId),
        fetchTaskActivity(token, year, goalId),
        fetchTaskTimeline(token, goalId)
      ]);
      const healthGoalId =
        goalId ??
        currentGoalId ??
        todayResponse.tasks.find((task) => task.status !== "PREVIEW")?.goalId;

      setTodayTasks(todayResponse.tasks);
      setActivityDays(activityResponse.days);
      setTimelineDays(timelineResponse.days);
      setTimelineMessage(
        timelineResponse.items.length
          ? `最近 ${timelineResponse.items.length} 条成长记录。`
          : "暂无复盘记录，先完成今日任务生成第一条时间线。"
      );
      if (healthGoalId) {
        setGoalHealth(await fetchGoalHealth(token, healthGoalId));
      } else {
        setGoalHealth(null);
      }
      setDailyTaskMessage(
        todayResponse.tasks.length
          ? `今日有 ${todayResponse.tasks.length} 个可执行任务。`
          : "今天暂无可执行任务，请先确认 AI 计划。"
      );
    } catch (error) {
      setDailyTaskMessage(
        error instanceof Error ? error.message : "任务数据加载失败"
      );
      setTimelineMessage(
        error instanceof Error ? error.message : "成长时间线加载失败"
      );
    } finally {
      setIsLoadingDailyTasks(false);
      setIsLoadingTimeline(false);
    }
  }

  async function loadRewardBoard(token = session?.token, goalId = selectedGoalId) {
    if (!token || !goalId) {
      setRewardBoard(null);
      setRewardMessage("选择目标后可维护奖励愿景板。");
      return;
    }

    setIsLoadingRewards(true);

    try {
      const board = await fetchRewardBoard(token, goalId);
      setRewardBoard(board);
      setRewardMessage(
        board.cards.length
          ? `${board.cards.length} 张奖励卡片已同步。`
          : "暂无奖励卡片，可先添加一个文字奖励。"
      );
    } catch (error) {
      setRewardMessage(error instanceof Error ? error.message : "奖励愿景板加载失败");
    } finally {
      setIsLoadingRewards(false);
    }
  }

  function updateRewardField(
    field: keyof typeof rewardForm,
    value: string
  ) {
    setRewardForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleCreateRewardCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !selectedGoalId) {
      setRewardMessage("请先登录并选择目标。");
      return;
    }

    try {
      await createRewardCard(session.token, selectedGoalId, {
        title: rewardForm.title,
        description: rewardForm.description || null,
        cardType: rewardForm.cardType,
        imageUrl: rewardForm.imageUrl || null,
        linkUrl: rewardForm.linkUrl || null,
        sortOrder: rewardCardsForGoal.length
      });
      setRewardForm({
        title: "",
        description: "",
        cardType: "TEXT",
        imageUrl: "",
        linkUrl: ""
      });
      await loadRewardBoard(session.token, selectedGoalId);
      setRewardMessage("奖励卡片已保存。");
    } catch (error) {
      setRewardMessage(error instanceof Error ? error.message : "奖励卡片保存失败");
    }
  }

  async function handleMoveRewardCard(card: RewardCard, direction: -1 | 1) {
    if (!session || !selectedGoalId || card.sourceType !== "CUSTOM") {
      return;
    }

    const nextSortOrder = Math.max(0, card.sortOrder + direction);

    try {
      await updateRewardCard(session.token, selectedGoalId, card.id, {
        sortOrder: nextSortOrder
      });
      await loadRewardBoard(session.token, selectedGoalId);
      setRewardMessage("奖励卡片排序已更新。");
    } catch (error) {
      setRewardMessage(error instanceof Error ? error.message : "奖励卡片排序失败");
    }
  }

  async function handleDeleteRewardCard(card: RewardCard) {
    if (!session || !selectedGoalId) {
      return;
    }

    try {
      await deleteRewardCard(session.token, selectedGoalId, card.id);
      await loadRewardBoard(session.token, selectedGoalId);
      setRewardMessage("奖励卡片已删除。");
    } catch (error) {
      setRewardMessage(error instanceof Error ? error.message : "奖励卡片删除失败");
    }
  }

  async function handleDeleteSelectedGoal() {
    if (!session || !selectedGoal) {
      setGoalMessage("请先登录并选择目标。");
      return;
    }

    const confirmed = window.confirm(
      `确认删除目标「${selectedGoal.title}」及其任务、复盘、评分、偏差、奖励和健康快照数据？`
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteGoal(session.token, selectedGoal.id);
      setCreatedGoal(null);
      setGeneratedPlan(null);
      setTodayTasks([]);
      setActivityDays([]);
      setTimelineDays([]);
      setGoalHealth(null);
      setRewardBoard(null);
      setFailureReport(null);
      setSelectedGoalId(null);
      if (trackedAiJob?.goalId === selectedGoal.id) {
        setTrackedAiJob(null);
        setAiJobMessage("目标已删除，最近 AI 任务已清空。");
      }
      await refreshGoals(session.token);
      setGoalMessage("目标及关联数据已删除。");
      setActivePage("create");
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : "目标删除失败");
    }
  }

  async function handleDeleteCurrentAccount() {
    if (!session) {
      return;
    }

    const confirmed = window.confirm(
      "确认删除当前账号及全部目标、任务、复盘、奖励、提醒、会员和后台关联数据？此操作不可恢复。"
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteCurrentAccount(session.token);
      setSession(null);
      setTrackedAiJob(null);
      setAiJobMessage("账号已删除，最近 AI 任务已清空。");
      setActivePage("account");
      setGoalMessage("账号已删除。");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "账号删除失败");
    }
  }

  function toggleDataExportScope(scope: DataExportScope) {
    setDataExportForm((current) => {
      const scopes = current.scopes.includes(scope)
        ? current.scopes.filter((item) => item !== scope)
        : [...current.scopes, scope];

      return {
        ...current,
        scopes
      };
    });
  }

  async function handleExportCurrentAccountData() {
    if (!session) {
      setDataExportMessage("请先登录后再导出数据。");
      return;
    }

    setIsExportingData(true);

    try {
      const result = await exportCurrentAccountData(session.token, dataExportForm);
      setDataExportResult(result);
      setDataExportMessage(
        result.status === "READY"
          ? `导出已生成：${result.scopes.length} 个范围。`
          : result.message
      );
    } catch (error) {
      setDataExportMessage(error instanceof Error ? error.message : "数据导出失败");
    } finally {
      setIsExportingData(false);
    }
  }

  function downloadDataExportResult() {
    if (!dataExportResult?.data && !dataExportResult?.download) {
      return;
    }

    const blob = dataExportResult.download
      ? new Blob(
          [
            dataExportResult.download.encoding === "base64"
              ? decodeBase64Download(dataExportResult.download.content)
              : dataExportResult.download.content
          ],
          {
            type: dataExportResult.download.contentType
          }
        )
      : new Blob([JSON.stringify(dataExportResult, null, 2)], {
          type: "application/json"
        });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      dataExportResult.download?.filename ?? `${dataExportResult.exportId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function decodeBase64Download(content: string) {
    const binary = window.atob(content);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  function handleRewardImageUpload(file: File | null) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateRewardField("imageUrl", reader.result);
        updateRewardField("cardType", "IMAGE");
      }
    };
    reader.readAsDataURL(file);
  }

  function openCompletionDialog(task: TodayDailyTask) {
    setCompletionTask(task);
    setCompletionResult(null);
    setAppealResult(null);
    setAppealMessage("");
    setAppealForm({
      reason: "",
      addedFacts: ""
    });
    setCompletionForm({
      investedMinutes: task.plannedMinutes ? String(task.plannedMinutes) : "",
      completedContent: "",
      blockers: "",
      tomorrowAdjustment: "",
      completedSubtasks: task.title,
      actualQuestionCount: task.questionCount ? String(task.questionCount) : "",
      correctQuestionCount: "",
      evidenceFiles: "",
      evidenceLinks: "",
      studyMood: "",
      difficultyLevel: ""
    });
  }

  function closeCompletionDialog() {
    if (completingTaskId) {
      return;
    }

    setCompletionTask(null);
    setCompletionResult(null);
    setAppealResult(null);
    setAppealMessage("");
  }

  function updateCompletionField(
    field: keyof typeof completionForm,
    value: string
  ) {
    setCompletionForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateAppealField(field: keyof typeof appealForm, value: string) {
    setAppealForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function trackAiJob(job: AiJob, message = "AI 任务状态已记录，将自动更新。") {
    setTrackedAiJob(job);
    setAiJobMessage(message);
  }

  async function handleRefreshTrackedAiJob() {
    if (!session || !trackedAiJob) {
      setAiJobMessage("暂无可刷新的 AI 任务。");
      return;
    }

    setIsRefreshingAiJob(true);

    try {
      const response = await fetchAiJob(session.token, trackedAiJob.id);
      setTrackedAiJob(response.job);
      setCompletionResult((current) =>
        current?.job.id === response.job.id
          ? {
              ...current,
              job: response.job
            }
          : current
      );
      setAiJobMessage(
        `AI 任务已刷新：${aiJobStatusLabels[response.job.status] ?? response.job.status}`
      );
    } catch (error) {
      setAiJobMessage(
        error instanceof Error ? error.message : "AI 任务状态刷新失败"
      );
    } finally {
      setIsRefreshingAiJob(false);
    }
  }

  async function handleCompleteDailyTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!completionTask) {
      return;
    }

    if (!session) {
      setDailyTaskMessage("请先登录后再提交任务。");
      setActivePage("account");
      return;
    }

    const completedContent = completionForm.completedContent.trim();

    if (!completedContent) {
      setDailyTaskMessage("请填写今天完成了什么。");
      return;
    }

    const investedMinutes = completionForm.investedMinutes
      ? Number(completionForm.investedMinutes)
      : completionTask.plannedMinutes ?? undefined;
    const actualQuestionCount = completionForm.actualQuestionCount
      ? Number(completionForm.actualQuestionCount)
      : undefined;
    const correctQuestionCount = completionForm.correctQuestionCount
      ? Number(completionForm.correctQuestionCount)
      : undefined;
    const completedSubtasks = splitFormList(completionForm.completedSubtasks);
    const evidenceFiles = splitFormList(completionForm.evidenceFiles);
    const evidenceLinks = splitFormList(completionForm.evidenceLinks);
    const content = [
      `完成内容：${completedContent}`,
      completionForm.blockers.trim()
        ? `遇到的问题：${completionForm.blockers.trim()}`
        : "",
      completionForm.tomorrowAdjustment.trim()
        ? `明日调整：${completionForm.tomorrowAdjustment.trim()}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");

    setCompletingTaskId(completionTask.id);
    setDailyTaskMessage("正在提交今日完成记录...");

    try {
      const response = await completeDailyTask(session.token, completionTask.id, {
        content,
        investedMinutes,
        completedSubtasks,
        actualQuestionCount,
        correctQuestionCount,
        evidenceFiles,
        evidenceLinks,
        studyMood: completionForm.studyMood.trim() || undefined,
        difficultyLevel: completionForm.difficultyLevel.trim() || undefined
      });
      setDailyTaskMessage("任务已完成，热力图已更新。");
      setCompletionResult(response);
      trackAiJob(response.job, "打卡评分任务已记录，将自动更新状态。");
      if (completionTask.taskType === "RESCUE") {
        setRescueTask(null);
      }
      await refreshDailyTaskData(session.token, heatmapYear);
      setSelectedHeatmapDate(completionTask.date);
    } catch (error) {
      setDailyTaskMessage(
        error instanceof Error ? error.message : "任务完成提交失败"
      );
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handleAppealScore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !completionResult) {
      setAppealMessage("请先完成任务并获得评分。");
      return;
    }

    setIsSubmittingAppeal(true);

    try {
      const response = await appealCheckinScore(
        session.token,
        completionResult.checkin.id,
        {
          reason: appealForm.reason,
          addedFacts: appealForm.addedFacts
        }
      );
      setAppealResult(response.appeal);
      trackAiJob(response.job, "评分复评任务已记录，将自动更新状态。");
      setCompletionResult((current) =>
        current
          ? {
              ...current,
              checkin: response.checkin,
              job: response.job
            }
          : current
      );
      setAppealMessage(
        response.appeal.status === "RESCORED"
          ? "申诉复评已采纳，评分已更新。"
          : "申诉复评未采纳，原评分已维持。"
      );
      await refreshDailyTaskData(session.token, heatmapYear);
    } catch (error) {
      setAppealMessage(error instanceof Error ? error.message : "评分申诉提交失败");
    } finally {
      setIsSubmittingAppeal(false);
    }
  }

  function updateGoalField(field: keyof typeof goalForm, value: string) {
    setGoalForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateReplanField(field: keyof typeof replanForm, value: string) {
    setReplanForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleCreateGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      setGoalMessage("请先注册或登录，再创建目标草稿。");
      setActivePage("account");
      return;
    }

    setIsCreatingGoal(true);
    setGoalMessage("正在保存目标草稿...");

    try {
      const response = await createGoal(session.token, {
        title: goalForm.title || undefined,
        description: goalForm.description,
        category: goalForm.category,
        startDate: goalForm.startDate,
        endDate: goalForm.endDate,
        dailyTimeBudgetMinutes: goalForm.dailyTimeBudgetMinutes
          ? Number(goalForm.dailyTimeBudgetMinutes)
          : undefined,
        toleranceDaysAllowed: goalForm.toleranceDaysAllowed
          ? Number(goalForm.toleranceDaysAllowed)
          : undefined,
        currentBaseline: goalForm.currentBaseline || undefined,
        constraints: goalForm.constraints || undefined,
        finalReward: goalForm.finalReward || undefined
      });

      setCreatedGoal(response.goal);
      setSelectedGoalId(response.goal.id);
      setGeneratedPlan(null);
      setGoalMessage(`目标草稿已保存：${response.goal.title}`);
      setPlanMessage("草稿已就绪，可以生成 AI 计划。");
      await refreshGoals(session.token, response.goal.id);
      setActivePage("goals");
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : "目标创建失败");
    } finally {
      setIsCreatingGoal(false);
    }
  }

  async function handleGeneratePlan() {
    const targetGoal = selectedGoal ?? createdGoal;

    if (!session || !targetGoal) {
      setPlanMessage("请先登录并保存目标草稿。");
      return;
    }

    setIsGeneratingPlan(true);
    setPlanMessage("正在生成 AI 计划...");

    try {
      const response = await generateGoalPlan(session.token, targetGoal.id);

      setCreatedGoal(response.goal);
      setGeneratedPlan(response.plan);
      trackAiJob(response.job, "计划生成任务已记录，将自动更新状态。");
      setSelectedGoalId(response.goal.id);
      setGoals((current) =>
        current.some((goal) => goal.id === response.goal.id)
          ? current.map((goal) => (goal.id === response.goal.id ? response.goal : goal))
          : [response.goal, ...current]
      );
      setPlanMessage(
        response.plan
          ? "AI 计划已生成，确认后目标会进入执行状态。"
          : response.job.error ?? "计划生成失败"
      );
      if (response.plan) {
        setActivePage("plan");
      }
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "AI 计划生成失败");
    } finally {
      setIsGeneratingPlan(false);
    }
  }

  async function handleRequestReplan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const targetGoal = selectedGoal ?? createdGoal;

    if (!session || !targetGoal) {
      setPlanMessage("请先登录并选择执行中的目标。");
      return;
    }

    if (replanForm.adjustmentReason.trim().length < 8) {
      setPlanMessage("请写清楚为什么需要调整计划。");
      return;
    }

    setIsRequestingReplan(true);
    setPlanMessage("正在重新评估并生成调整计划...");

    try {
      const response = await requestGoalReplan(session.token, targetGoal.id, {
        adjustmentReason: replanForm.adjustmentReason,
        constraints: replanForm.constraints || undefined,
        currentBaseline: replanForm.currentBaseline || undefined,
        dailyTimeBudgetMinutes: replanForm.dailyTimeBudgetMinutes
          ? Number(replanForm.dailyTimeBudgetMinutes)
          : undefined
      });

      setCreatedGoal(response.goal);
      setGeneratedPlan(response.plan);
      trackAiJob(response.job, "计划调整任务已记录，将自动更新状态。");
      setSelectedGoalId(response.goal.id);
      setGoals((current) =>
        current.some((goal) => goal.id === response.goal.id)
          ? current.map((goal) => (goal.id === response.goal.id ? response.goal : goal))
          : [response.goal, ...current]
      );
      setPlanMessage(
        response.plan
          ? `调整计划已生成，版本 ${response.plan.version}，确认后恢复执行。`
          : response.job.error ?? "计划调整失败"
      );
      setReplanForm({
        adjustmentReason: "",
        dailyTimeBudgetMinutes: "",
        constraints: "",
        currentBaseline: ""
      });
      setActivePage("plan");
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "计划调整失败");
    } finally {
      setIsRequestingReplan(false);
    }
  }

  async function handleConfirmPlan() {
    const targetGoal = selectedGoal ?? createdGoal;

    if (!session || !targetGoal) {
      setPlanMessage("请先登录并生成计划。");
      return;
    }

    setIsConfirmingPlan(true);
    setPlanMessage("正在确认计划...");

    try {
      const response = await confirmGoalPlan(session.token, targetGoal.id);

      setCreatedGoal(response.goal);
      setGeneratedPlan(response.plan);
      setSelectedGoalId(response.goal.id);
      setGoals((current) =>
        current.some((goal) => goal.id === response.goal.id)
          ? current.map((goal) => (goal.id === response.goal.id ? response.goal : goal))
          : [response.goal, ...current]
      );
      setPlanMessage("计划已确认，目标已进入执行状态。");
      await refreshDailyTaskData(session.token, heatmapYear, response.goal.id);
      setActivePage("today");
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "计划确认失败");
    } finally {
      setIsConfirmingPlan(false);
    }
  }

  async function handleGenerateRescueTask() {
    const goalId = selectedGoalId ?? currentGoalId;

    if (!session || !goalId) {
      setDailyTaskMessage("请先登录并选择一个目标。");
      return;
    }

    setIsGeneratingRescueTask(true);
    setDailyTaskMessage("正在生成救援任务...");

    try {
      const response = await generateRescueTask(session.token, goalId);

      setRescueTask(response.rescueTask);
      setGoalHealth((current) =>
        current && current.goalId === response.goalId
          ? { ...current, deviation: response.deviation }
          : current
      );
      await refreshDailyTaskData(session.token, heatmapYear, response.goalId);
      setDailyTaskMessage("救援任务已保存到今日任务，可以直接完成。");
    } catch (error) {
      setDailyTaskMessage(
        error instanceof Error ? error.message : "救援任务生成失败"
      );
    } finally {
      setIsGeneratingRescueTask(false);
    }
  }

  async function handleSettleSelectedGoal() {
    if (!session || !selectedGoalId) {
      setGoalMessage("请先登录并选择目标。");
      return;
    }

    setIsSettlingGoal(true);

    try {
      const result = await settleGoal(session.token, selectedGoalId);
      await refreshGoals(session.token, result.goal.id);

      if (result.failureReport) {
        setFailureReport(result.failureReport);
        setActivePage("failure");
      }

      setGoalMessage(
        result.goal.status === "FAILED"
          ? "目标已进入失败状态，失败复盘已生成。"
          : result.goal.status === "COMPLETED"
            ? "目标已达结束日期并完成结算。"
            : `目标已更新容错使用：${result.settlement.toleranceDaysUsed}/${result.settlement.toleranceDaysAllowed}`
      );
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : "目标状态结算失败");
    } finally {
      setIsSettlingGoal(false);
    }
  }

  async function loadFailureReport(token = session?.token, goalId = selectedGoalId) {
    if (!token || !goalId) {
      setFailureReport(null);
      setFailureMessage("选择失败目标后可查看失败复盘。");
      return;
    }

    setIsLoadingFailureReport(true);

    try {
      const report = await fetchFailureReport(token, goalId);
      setFailureReport(report);
      setFailureMessage("失败复盘已生成，可根据建议重新开启新目标。");
    } catch (error) {
      setFailureMessage(error instanceof Error ? error.message : "失败复盘加载失败");
    } finally {
      setIsLoadingFailureReport(false);
    }
  }

  async function handleRestartGoal() {
    if (!session || !selectedGoalId || !failureReport) {
      setFailureMessage("请先选择失败目标并加载失败复盘。");
      return;
    }

    setIsRestartingGoal(true);

    try {
      const response = await restartGoal(
        session.token,
        selectedGoalId,
        failureReport.restartGoalDraft
      );
      await refreshGoals(session.token, response.goal.id);
      setCreatedGoal(response.goal);
      setActivePage("plan");
      setPlanMessage("新目标草稿已创建，可重新生成 AI 计划。");
    } catch (error) {
      setFailureMessage(error instanceof Error ? error.message : "重新开启目标失败");
    } finally {
      setIsRestartingGoal(false);
    }
  }

  function renderAiJobStatusPanel() {
    return (
      <section className="ai-job-status">
        <div>
          <p className="eyebrow">AI job</p>
          <h2>最近 AI 任务</h2>
        </div>
        {trackedAiJob ? (
          <>
            <div className="ai-job-metrics">
              <span>
                类型
                <strong>
                  {aiJobTypeLabels[trackedAiJob.type] ?? trackedAiJob.type}
                </strong>
              </span>
              <span>
                状态
                <strong>
                  {aiJobStatusLabels[trackedAiJob.status] ?? trackedAiJob.status}
                </strong>
              </span>
              <span>
                尝试
                <strong>{trackedAiJob.attempts}</strong>
              </span>
              <span>
                更新时间
                <strong>{formatDateTime(trackedAiJob.updatedAt)}</strong>
              </span>
            </div>
            {trackedAiJob.error ? (
              <p className="form-message">{trackedAiJob.error}</p>
            ) : null}
          </>
        ) : (
          <p className="muted-text">完成计划生成、重规划、打卡评分或复评后显示。</p>
        )}
        <div className="form-actions">
          <button
            className="ghost-button"
            disabled={!trackedAiJob || isRefreshingAiJob}
            type="button"
            onClick={handleRefreshTrackedAiJob}
          >
            {isRefreshingAiJob ? "刷新中" : "刷新状态"}
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <span className="form-message">{aiJobMessage}</span>
        </div>
      </section>
    );
  }

  async function loadNotificationSettings(token = session?.token) {
    if (!token) {
      return;
    }

    try {
      const [preference, logsResponse, bindingResponse] = await Promise.all([
        fetchNotificationPreference(token),
        fetchEmailLogs(token),
        fetchWechatBinding(token)
      ]);
      setNotificationPreference(preference);
      setEmailLogs(logsResponse.logs);
      setWechatBinding(bindingResponse.binding);
      setWechatForm({
        openId: bindingResponse.binding?.openId ?? "",
        unionId: bindingResponse.binding?.unionId ?? "",
        nickname: bindingResponse.binding?.nickname ?? ""
      });
      setNotificationMessage("邮件提醒偏好已加载。");
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : "提醒设置加载失败"
      );
    }
  }

  function updateNotificationPreferenceField(
    field: "enabled" | "reminderTime",
    value: boolean | string
  ) {
    setNotificationPreference((current) =>
      current
        ? {
            ...current,
            [field]: value
          }
        : current
    );
  }

  function toggleReminderType(type: ReminderType) {
    setNotificationPreference((current) => {
      if (!current) {
        return current;
      }

      const hasType = current.reminderTypes.includes(type);
      const reminderTypes = hasType
        ? current.reminderTypes.filter((item) => item !== type)
        : [...current.reminderTypes, type];

      return {
        ...current,
        reminderTypes
      };
    });
  }

  function toggleNotificationChannel(channel: NotificationChannel) {
    setNotificationPreference((current) => {
      if (!current) {
        return current;
      }

      const hasChannel = current.channels.includes(channel);
      const channels = hasChannel
        ? current.channels.filter((item) => item !== channel)
        : [...current.channels, channel];

      return {
        ...current,
        channels
      };
    });
  }

  function updateWechatField(field: keyof typeof wechatForm, value: string) {
    setWechatForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSaveNotificationPreference() {
    if (!session || !notificationPreference) {
      setNotificationMessage("请先登录并加载提醒设置。");
      return;
    }

    setIsSavingNotificationPreference(true);

    try {
      const saved = await updateNotificationPreference(session.token, {
        enabled: notificationPreference.enabled,
        reminderTime: notificationPreference.reminderTime,
        reminderTypes: notificationPreference.reminderTypes,
        channels: notificationPreference.channels,
        timezone: notificationPreference.timezone
      });
      setNotificationPreference(saved);
      setNotificationMessage("提醒偏好已保存。");
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : "提醒偏好保存失败"
      );
    } finally {
      setIsSavingNotificationPreference(false);
    }
  }

  async function handleBindWechat() {
    if (!session) {
      setNotificationMessage("请先登录后再绑定微信。");
      return;
    }

    setIsSavingNotificationPreference(true);

    try {
      const response = await bindWechat(session.token, {
        openId: wechatForm.openId,
        unionId: wechatForm.unionId || undefined,
        nickname: wechatForm.nickname || undefined
      });
      setWechatBinding(response.binding);
      setNotificationMessage("微信提醒账号已绑定。");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "微信绑定失败");
    } finally {
      setIsSavingNotificationPreference(false);
    }
  }

  async function handleUnbindWechat() {
    if (!session) {
      setNotificationMessage("请先登录后再解绑微信。");
      return;
    }

    setIsSavingNotificationPreference(true);

    try {
      await unbindWechat(session.token);
      setWechatBinding(null);
      setWechatForm({
        openId: "",
        unionId: "",
        nickname: ""
      });
      setNotificationMessage("微信提醒账号已解绑。");
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "微信解绑失败");
    } finally {
      setIsSavingNotificationPreference(false);
    }
  }

  async function handleCreatePreviewEmailLog(type?: ReminderType) {
    if (!session) {
      setNotificationMessage("请先登录。");
      return;
    }

    try {
      await createPreviewEmailLog(session.token, {
        type,
        goalId: selectedGoalId
      });
      const logsResponse = await fetchEmailLogs(session.token);
      setEmailLogs(logsResponse.logs);
      setNotificationMessage("提醒预览已写入邮件日志。");
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : "提醒预览创建失败"
      );
    }
  }

  async function handleEnqueueDueEmailLogs() {
    if (!session) {
      setNotificationMessage("请先登录。");
      return;
    }

    try {
      const result = await enqueueDueEmailLogs(session.token);
      const logsResponse = await fetchEmailLogs(session.token);
      setEmailLogs(logsResponse.logs);
      setNotificationMessage(
        result.queued.length
          ? `已生成 ${result.queued.length} 条今日提醒。`
          : result.skipped[0] ?? "当前没有需要生成的提醒。"
      );
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : "提醒队列生成失败"
      );
    }
  }

  async function handleProcessQueuedEmailLogs() {
    if (!session) {
      setNotificationMessage("请先登录。");
      return;
    }

    try {
      const result = await processQueuedEmailLogs(session.token);
      const logsResponse = await fetchEmailLogs(session.token);
      setEmailLogs(logsResponse.logs);
      setNotificationMessage(
        `邮件队列已处理：成功 ${result.sent} 条，失败 ${result.failed} 条。`
      );
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : "邮件队列处理失败"
      );
    }
  }

  async function handleRetryFailedEmailLogs() {
    if (!session) {
      setNotificationMessage("请先登录后再重试失败邮件。");
      return;
    }

    setIsSavingNotificationPreference(true);

    try {
      const result = await retryFailedEmailLogs(session.token);
      const logsResponse = await fetchEmailLogs(session.token);
      setEmailLogs(logsResponse.logs);
      setNotificationMessage(
        result.retried.length
          ? `已重新排队 ${result.retried.length} 条失败邮件。`
          : result.skipped[0] ?? "暂无可重试的失败邮件。"
      );
    } catch (error) {
      setNotificationMessage(
        error instanceof Error ? error.message : "失败邮件重试失败"
      );
    } finally {
      setIsSavingNotificationPreference(false);
    }
  }

  async function loadAdminDashboard(token = session?.token) {
    if (!token) {
      setAdminMessage("管理员账号登录后可查看后台。");
      return;
    }

    setIsLoadingAdmin(true);

    try {
      const [
        overview,
        usersResponse,
        goalsResponse,
        jobsResponse,
        logsResponse,
        auditResponse,
        configsResponse
      ] = await Promise.all([
        fetchAdminOverview(token),
        fetchAdminUsers(token, adminUserFilters),
        fetchAdminGoals(token, adminGoalFilters),
        fetchAdminAiJobs(token, adminAiJobFilters),
        fetchAdminEmailLogs(token, adminEmailLogFilters),
        fetchAdminAuditLogs(token),
        fetchAdminSystemConfigs(token)
      ]);

      setAdminOverview(overview);
      setAdminUsers(usersResponse.users);
      setAdminUserTotal(usersResponse.total);
      setAdminGoals(goalsResponse.goals);
      setAdminGoalTotal(goalsResponse.total);
      setAdminAiJobs(jobsResponse.jobs);
      setAdminAiJobTotal(jobsResponse.total);
      setAdminEmailLogs(logsResponse.logs);
      setAdminEmailLogTotal(logsResponse.total);
      setAdminAuditLogs(auditResponse.logs);
      setAdminSystemConfigs(configsResponse.configs);
      setAdminMessage("后台数据已加载。");
      setAdminRawForm((current) => ({
        ...current,
        userId: current.userId || usersResponse.users[0]?.id || ""
      }));
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "后台数据加载失败");
    } finally {
      setIsLoadingAdmin(false);
    }
  }

  function updateAdminUserFilter(field: keyof AdminUserFilters, value: string) {
    setAdminUserFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSearchAdminUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    setIsLoadingAdmin(true);

    try {
      const usersResponse = await fetchAdminUsers(session.token, adminUserFilters);
      setAdminUsers(usersResponse.users);
      setAdminUserTotal(usersResponse.total);
      setAdminRawForm((current) => ({
        ...current,
        userId: usersResponse.users.some((user) => user.id === current.userId)
          ? current.userId
          : usersResponse.users[0]?.id ?? ""
      }));
      setAdminMessage(
        usersResponse.total
          ? `找到 ${usersResponse.total} 个用户。`
          : "没有匹配的用户。"
      );
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "后台用户搜索失败");
    } finally {
      setIsLoadingAdmin(false);
    }
  }

  async function handleResetAdminUserFilters() {
    const nextFilters = {
      query: "",
      status: "",
      plan: "",
      adminRole: ""
    };
    setAdminUserFilters(nextFilters);

    if (!session) {
      return;
    }

    setIsLoadingAdmin(true);

    try {
      const usersResponse = await fetchAdminUsers(session.token, nextFilters);
      setAdminUsers(usersResponse.users);
      setAdminUserTotal(usersResponse.total);
      setAdminRawForm((current) => ({
        ...current,
        userId: usersResponse.users[0]?.id ?? ""
      }));
      setAdminMessage("用户筛选已清空。");
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "后台用户列表刷新失败");
    } finally {
      setIsLoadingAdmin(false);
    }
  }

  function updateAdminGoalFilter(field: keyof AdminGoalFilters, value: string) {
    setAdminGoalFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateAdminAiJobFilter(field: keyof AdminAiJobFilters, value: string) {
    setAdminAiJobFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateAdminEmailLogFilter(
    field: keyof AdminEmailLogFilters,
    value: string
  ) {
    setAdminEmailLogFilters((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSearchAdminGoals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    setIsLoadingAdmin(true);

    try {
      const response = await fetchAdminGoals(session.token, adminGoalFilters);
      setAdminGoals(response.goals);
      setAdminGoalTotal(response.total);
      setAdminMessage(response.total ? `找到 ${response.total} 个目标。` : "没有匹配的目标。");
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "后台目标搜索失败");
    } finally {
      setIsLoadingAdmin(false);
    }
  }

  async function handleSearchAdminAiJobs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    setIsLoadingAdmin(true);

    try {
      const response = await fetchAdminAiJobs(session.token, adminAiJobFilters);
      setAdminAiJobs(response.jobs);
      setAdminAiJobTotal(response.total);
      setAdminMessage(
        response.total ? `找到 ${response.total} 个 AI 任务。` : "没有匹配的 AI 任务。"
      );
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "后台 AI 任务搜索失败");
    } finally {
      setIsLoadingAdmin(false);
    }
  }

  async function handleSearchAdminEmailLogs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    setIsLoadingAdmin(true);

    try {
      const response = await fetchAdminEmailLogs(
        session.token,
        adminEmailLogFilters
      );
      setAdminEmailLogs(response.logs);
      setAdminEmailLogTotal(response.total);
      setAdminMessage(
        response.total ? `找到 ${response.total} 条提醒日志。` : "没有匹配的提醒日志。"
      );
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "后台提醒日志搜索失败");
    } finally {
      setIsLoadingAdmin(false);
    }
  }

  async function handleOpenProMembership(userId: string) {
    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    setAdminMembershipUpdatingUserId(userId);

    try {
      await updateAdminMembership(session.token, userId, {
        plan: "PRO",
        status: "MANUAL",
        reason: "后台手动开通 PRO 会员"
      });
      await loadAdminDashboard(session.token);
      setAdminMessage("会员已手动开通为 PRO。");
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "会员状态更新失败");
    } finally {
      setAdminMembershipUpdatingUserId(null);
    }
  }

  async function handleLoadAdminRawContent() {
    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    const reason = adminRawForm.reason.trim();

    if (!adminRawForm.userId || reason.length < 6) {
      setAdminMessage("请选择用户并填写至少 6 个字符的查看原因。");
      return;
    }

    try {
      const rawContent = await fetchAdminRawContent(
        session.token,
        adminRawForm.userId,
        reason
      );
      const auditResponse = await fetchAdminAuditLogs(session.token);
      setAdminRawContent(rawContent);
      setAdminAuditLogs(auditResponse.logs);
      setAdminMessage("敏感原文已加载，并已写入审计日志。");
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "敏感原文加载失败");
    }
  }

  async function handleRetryAdminAiJob(job: AdminAiJob) {
    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    const reason = window.prompt("请输入重试失败 AI 任务的原因", "后台排查后手动重试");

    if (!reason) {
      return;
    }

    setAdminRetryingAiJobId(job.id);

    try {
      const result = await retryAdminAiJob(session.token, job.id, { reason });
      const [jobsResponse, auditResponse] = await Promise.all([
        fetchAdminAiJobs(session.token, adminAiJobFilters),
        fetchAdminAuditLogs(session.token)
      ]);
      setAdminAiJobs(jobsResponse.jobs);
      setAdminAiJobTotal(jobsResponse.total);
      setAdminAuditLogs(auditResponse.logs);
      setAdminMessage(
        result.queue.queued
          ? "AI 任务已重新入队。"
          : `AI 任务已标记重试，队列未启用：${result.queue.reason ?? result.queue.error ?? "待 worker 处理"}`
      );
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "AI 任务重试失败");
    } finally {
      setAdminRetryingAiJobId(null);
    }
  }

  function updateAdminConfigField(
    field: keyof typeof adminConfigForm,
    value: string
  ) {
    setAdminConfigForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSaveAdminConfig() {
    if (!session) {
      setAdminMessage("请先登录管理员账号。");
      return;
    }

    let parsedValue: unknown;

    try {
      parsedValue = JSON.parse(adminConfigForm.value);
    } catch {
      setAdminMessage("系统配置值必须是合法 JSON。");
      return;
    }

    setIsSavingAdminConfig(true);

    try {
      await upsertAdminSystemConfig(session.token, {
        key: adminConfigForm.key,
        value: parsedValue,
        description: adminConfigForm.description || null,
        reason: adminConfigForm.reason
      });
      const [configsResponse, auditResponse] = await Promise.all([
        fetchAdminSystemConfigs(session.token),
        fetchAdminAuditLogs(session.token)
      ]);
      setAdminSystemConfigs(configsResponse.configs);
      setAdminAuditLogs(auditResponse.logs);
      setAdminMessage("系统配置已保存，并已写入审计日志。");
    } catch (error) {
      setAdminMessage(error instanceof Error ? error.message : "系统配置保存失败");
    } finally {
      setIsSavingAdminConfig(false);
    }
  }

  function renderPage() {
    switch (activePage) {
      case "create":
        return (
          <div className="content-grid">
            <section className="panel main-panel" aria-labelledby="goal-title">
              <div className="section-heading">
                <p className="eyebrow">Goal intake</p>
                <h1 id="goal-title">创建目标</h1>
              </div>

              <form className="goal-form" onSubmit={handleCreateGoal}>
                <label>
                  <span>目标标题</span>
                  <input
                    value={goalForm.title}
                    onChange={(event) =>
                      updateGoalField("title", event.target.value)
                    }
                    placeholder={goalPlaceholders.title}
                  />
                </label>

                <label>
                  <span>目标描述</span>
                  <textarea
                    value={goalForm.description}
                    onChange={(event) =>
                      updateGoalField("description", event.target.value)
                    }
                    placeholder={goalPlaceholders.description}
                    rows={4}
                    required
                  />
                </label>

                <div className="form-row">
                  <label>
                    <span>类型</span>
                    <select
                      value={goalForm.category}
                      onChange={(event) =>
                        updateGoalField("category", event.target.value)
                      }
                    >
                      <option value="study">学习考证</option>
                      <option value="career">职业成长</option>
                      <option value="fitness">健身减脂</option>
                      <option value="habit">自律习惯</option>
                      <option value="custom">其他目标</option>
                    </select>
                  </label>
                  <label>
                    <span>每日投入分钟</span>
                    <input
                      value={goalForm.dailyTimeBudgetMinutes}
                      onChange={(event) =>
                        updateGoalField("dailyTimeBudgetMinutes", event.target.value)
                      }
                      min={1}
                      placeholder={goalPlaceholders.dailyTimeBudgetMinutes}
                      type="number"
                    />
                  </label>
                </div>

                <div className="form-row">
                  <label>
                    <span>开始日期</span>
                    <input
                      value={goalForm.startDate}
                      onChange={(event) =>
                        updateGoalField("startDate", event.target.value)
                      }
                      type="date"
                      required
                    />
                  </label>
                  <label>
                    <span>结束日期</span>
                    <input
                      value={goalForm.endDate}
                      onChange={(event) =>
                        updateGoalField("endDate", event.target.value)
                      }
                      type="date"
                      required
                    />
                  </label>
                </div>

                <div className="form-row">
                  <label>
                    <span>容错次数</span>
                    <input
                      value={goalForm.toleranceDaysAllowed}
                      onChange={(event) =>
                        updateGoalField("toleranceDaysAllowed", event.target.value)
                      }
                      min={0}
                      type="number"
                    />
                  </label>
                  <label>
                    <span>当前基础</span>
                    <input
                      value={goalForm.currentBaseline}
                      onChange={(event) =>
                        updateGoalField("currentBaseline", event.target.value)
                      }
                      placeholder={goalPlaceholders.currentBaseline}
                    />
                  </label>
                </div>

                <label>
                  <span>主要限制</span>
                  <input
                    value={goalForm.constraints}
                    onChange={(event) =>
                      updateGoalField("constraints", event.target.value)
                    }
                    placeholder={goalPlaceholders.constraints}
                  />
                </label>

                <label>
                  <span>完成奖励</span>
                  <input
                    value={goalForm.finalReward}
                    onChange={(event) =>
                      updateGoalField("finalReward", event.target.value)
                    }
                    placeholder={goalPlaceholders.finalReward}
                  />
                </label>

                <div className="form-actions">
                  <button className="primary-button" disabled={isCreatingGoal}>
                    {isCreatingGoal ? "保存中" : "保存草稿"}
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <p className="form-message">{goalMessage}</p>
                </div>
              </form>
            </section>

            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Required fields</p>
                <div className="summary-strip">
                  {setupFields.map((field) => (
                    <span key={field}>{field}</span>
                  ))}
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Next state</p>
                <h2>AI 计划生成</h2>
                <p className="muted-text">
                  保存目标草稿后，可从目标草稿页触发 mock AI 生成阶段里程碑、每周计划和每日任务。
                </p>
              </section>
            </aside>
          </div>
        );
      case "goals":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <p className="eyebrow">Current goal</p>
              <h1>目标列表</h1>
              {goals.length ? (
                <div className="goal-list">
                  {goals.map((goal) => (
                    <button
                      className={`goal-record ${
                        goal.id === selectedGoalId ? "active" : ""
                      }`}
                      key={goal.id}
                      type="button"
                      onClick={() => {
                        setSelectedGoalId(goal.id);
                        setCreatedGoal(goal);
                        setPlanMessage("已切换当前目标。");
                      }}
                    >
                      <div>
                        <h2>{goal.title}</h2>
                        <p>{goal.description}</p>
                      </div>
                      <div className="metric-row">
                        <span>{goalStatusLabels[goal.status] ?? goal.status}</span>
                        <span>{goal.category}</span>
                        <span>容错 {goal.toleranceDaysAllowed} 天</span>
                        <span>
                          {formatDate(goal.startDate)} - {formatDate(goal.endDate)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <ShieldCheck size={24} aria-hidden="true" />
                  <h2>暂无目标</h2>
                  <p>保存目标后会显示在这里。</p>
                </div>
              )}

              {selectedGoal ? (
                <article className="record-card goal-dashboard">
                  <div className="dashboard-hero">
                    <div>
                      <p className="eyebrow">Goal cockpit</p>
                      <h2>{selectedGoal.title}</h2>
                      <p>{selectedGoal.description}</p>
                    </div>
                    <div className="dashboard-status">
                      <span>{selectedGoalStatus}</span>
                      <strong>{selectedGoal.status}</strong>
                    </div>
                  </div>

                  <div className="dashboard-metrics">
                    <div>
                      <span>健康度</span>
                      <strong>{goalHealth?.healthScore ?? "-"}</strong>
                    </div>
                    <div>
                      <span>今日任务</span>
                      <strong>
                        {todayTaskCount ? `${todayCompletedCount}/${todayTaskCount}` : "待生成"}
                      </strong>
                    </div>
                    <div>
                      <span>计划任务</span>
                      <strong>{selectedPlanTaskCount ? `${selectedPlanTaskCount} 个` : "待排期"}</strong>
                    </div>
                    <div>
                      <span>容错剩余</span>
                      <strong>{goalHealth?.toleranceRemaining ?? selectedGoal.toleranceDaysAllowed}</strong>
                    </div>
                  </div>

                  <section className="next-action-card">
                    <div>
                      <p className="eyebrow">Next action</p>
                      <h2>{dashboardAction.label}</h2>
                      <p>{dashboardAction.description}</p>
                    </div>
                    <button
                      className="primary-button"
                      disabled={dashboardAction.disabled}
                      type="button"
                      onClick={() => {
                        void dashboardAction.run();
                      }}
                    >
                      {dashboardAction.label}
                      <dashboardAction.icon size={16} aria-hidden="true" />
                    </button>
                  </section>

                  <div className="dashboard-jumps" aria-label="当前目标快捷入口">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setActivePage("today")}
                    >
                      今日任务
                      <CalendarCheck size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setActivePage("heatmap")}
                    >
                      成长热力图
                      <LineChart size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setActivePage("timeline")}
                    >
                      成长时间线
                      <History size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setActivePage("rewards")}
                    >
                      奖励愿景板
                      <Gift size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="ghost-button"
                      disabled={isSettlingGoal}
                      type="button"
                      onClick={() => void handleSettleSelectedGoal()}
                    >
                      {isSettlingGoal ? "结算中" : "结算状态"}
                      <ShieldCheck size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleDeleteSelectedGoal()}
                    >
                      删除目标
                      <ShieldCheck size={16} aria-hidden="true" />
                    </button>
                    {selectedGoal.status === "FAILED" ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setActivePage("failure")}
                      >
                        失败复盘
                        <History size={16} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>

                  <section className="dashboard-progress">
                    <div className="section-heading compact-heading">
                      <p className="eyebrow">Recent progress</p>
                      <h2>最近进展</h2>
                    </div>
                    {recentTimelineItems.length ? (
                      <div className="mini-progress-list">
                        {recentTimelineItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => openTimelineDate(item.date)}
                          >
                            <div>
                              <strong>{item.taskTitle}</strong>
                              <span>
                                {formatActivityDate(item.date)} ·{" "}
                                {item.investedMinutes ?? item.plannedMinutes ?? 0} 分钟
                              </span>
                            </div>
                            <em>
                              {item.aiScore ? `AI ${item.aiScore.totalScore}` : "待评分"}
                            </em>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-inline">
                        <span>暂无复盘记录</span>
                        <p>完成今日任务后，这里会显示最近 3 条执行反馈。</p>
                      </div>
                    )}
                  </section>

                  <p className="form-message">{planMessage}</p>

                  {selectedGeneratedPlan ? (
                    <div className="plan-preview">
                      <section className="plan-section">
                        <p className="eyebrow">Plan summary</p>
                        <h2>计划摘要</h2>
                        <p>{selectedGeneratedPlan.summary}</p>
                      </section>
                      <section className="plan-section">
                        <p className="eyebrow">Milestones</p>
                        <h2>阶段里程碑</h2>
                        <div className="timeline-list">
                          {selectedGeneratedPlan.milestones.map((milestone) => (
                            <div key={milestone.id}>
                              <strong>{milestone.title}</strong>
                              <span>{formatDate(milestone.targetDate)}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                      <section className="plan-section">
                        <p className="eyebrow">Weekly plan</p>
                        <h2>每周计划</h2>
                        <div className="weekly-plan-list">
                          {selectedGeneratedPlan.weeklyPlans.slice(0, 4).map((weeklyPlan) => (
                            <article key={weeklyPlan.id}>
                              <div>
                                <strong>{weeklyPlan.title}</strong>
                                <span>
                                  {formatDate(weeklyPlan.startsOn)} -{" "}
                                  {formatDate(weeklyPlan.endsOn)}
                                </span>
                              </div>
                              <p>{weeklyPlan.summary}</p>
                              <div className="daily-task-chips">
                                {weeklyPlan.dailyTasks.slice(0, 3).map((task) => (
                                  <span key={task.id}>
                                    {formatDate(task.taskDate)} · {task.title}
                                  </span>
                                ))}
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    </div>
                  ) : null}
                </article>
              ) : null}
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Health</p>
                <div className="metric-grid">
                  {healthPanelMetrics.map((metric) => (
                    <div className={`metric-card ${metric.tone}`} key={metric.label}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Timeline</p>
                <div className="timeline-list">
                  <div>
                    <strong>当前目标</strong>
                    <span>{selectedGoalStatus}</span>
                  </div>
                  <div>
                    <strong>阶段里程碑</strong>
                    <span>{selectedGeneratedPlan ? `${selectedGeneratedPlan.milestones.length} 个` : "待生成"}</span>
                  </div>
                  <div>
                    <strong>每日任务</strong>
                    <span>
                      {selectedGeneratedPlan
                        ? `${selectedGeneratedPlan.weeklyPlans.reduce(
                            (count, weeklyPlan) =>
                              count + weeklyPlan.dailyTasks.length,
                            0
                          )} 个`
                        : "待排期"}
                    </span>
                  </div>
                  <div>
                    <strong>计划确认</strong>
                    <span>{selectedGeneratedPlan?.isActive ? "已确认" : "待确认"}</span>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        );
      case "plan":
        return (
          <div className="content-grid plan-review-grid">
            <section className="panel main-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Plan review</p>
                  <h1>AI 计划确认</h1>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setActivePage("goals")}
                >
                  当前目标
                  <ShieldCheck size={16} aria-hidden="true" />
                </button>
              </div>

              {!selectedGoal ? (
                <div className="empty-state">
                  <CheckCircle2 size={24} aria-hidden="true" />
                  <h2>请选择目标</h2>
                  <p>先创建或选择一个目标，再生成 AI 计划。</p>
                </div>
              ) : !selectedGeneratedPlan ? (
                <div className="empty-state">
                  <Sparkles size={24} aria-hidden="true" />
                  <h2>{isLoadingPlan ? "正在加载计划" : "暂无待确认计划"}</h2>
                  <p>{planMessage}</p>
                  <div className="form-actions">
                    <button
                      className="primary-button"
                      disabled={isGeneratingPlan || isLoadingPlan}
                      type="button"
                      onClick={handleGeneratePlan}
                    >
                      {isGeneratingPlan ? "生成中" : "生成 AI 计划"}
                      <Sparkles size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="plan-review">
                  <section className="plan-review-hero">
                    <div>
                      <p className="eyebrow">Plan summary</p>
                      <h2>{selectedGoal.title}</h2>
                      <p>{selectedGeneratedPlan.summary}</p>
                    </div>
                    <div className="dashboard-status">
                      <span>
                        {selectedGeneratedPlan.isActive ? "已确认" : "待确认"}
                      </span>
                      <strong>v{selectedGeneratedPlan.version}</strong>
                    </div>
                  </section>

                  <div className="dashboard-metrics">
                    {planReviewStats.map((stat) => (
                      <div key={stat.label}>
                        <span>{stat.label}</span>
                        <strong>{stat.value}</strong>
                      </div>
                    ))}
                  </div>

                  <section className="plan-review-section">
                    <div className="section-heading">
                      <p className="eyebrow">Milestones</p>
                      <h2>阶段里程碑</h2>
                    </div>
                    <div className="milestone-grid">
                      {selectedGeneratedPlan.milestones.map((milestone, index) => (
                        <article key={milestone.id}>
                          <span>{index + 1}</span>
                          <div>
                            <h3>{milestone.title}</h3>
                            <p>{milestone.description}</p>
                            <strong>{formatDate(milestone.targetDate)}</strong>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="plan-review-section">
                    <div className="section-heading">
                      <p className="eyebrow">Weekly plan</p>
                      <h2>每周计划与每日任务</h2>
                    </div>
                    <div className="plan-week-accordion">
                      {selectedGeneratedPlan.weeklyPlans.map((weeklyPlan) => (
                        <article key={weeklyPlan.id}>
                          <div className="plan-week-heading">
                            <div>
                              <span>Week {weeklyPlan.weekIndex}</span>
                              <h3>{weeklyPlan.title}</h3>
                              <p>{weeklyPlan.summary}</p>
                            </div>
                            <strong>
                              {formatDate(weeklyPlan.startsOn)} -{" "}
                              {formatDate(weeklyPlan.endsOn)}
                            </strong>
                          </div>
                          <div className="plan-task-grid">
                            {weeklyPlan.dailyTasks.map((task) => (
                              <div key={task.id}>
                                <span>{formatDate(task.taskDate)}</span>
                                <strong>{task.title}</strong>
                                <p>{task.description}</p>
                                {getStudyTaskMeta(task).length ? (
                                  <div className="daily-task-chips">
                                    {getStudyTaskMeta(task).map((meta) => (
                                      <span key={meta}>{meta}</span>
                                    ))}
                                  </div>
                                ) : null}
                                <em>
                                  {task.plannedMinutes
                                    ? `${task.plannedMinutes} 分钟`
                                    : "待估时"}
                                </em>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <div className="form-actions">
                    <button
                      className="primary-button"
                      disabled={
                        isConfirmingPlan ||
                        selectedGeneratedPlan.isActive ||
                        selectedGoal.status !== "WAITING_CONFIRMATION"
                      }
                      type="button"
                      onClick={handleConfirmPlan}
                    >
                      {isConfirmingPlan ? "确认中" : "确认计划并开始执行"}
                      <CheckCircle2 size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="ghost-button"
                      disabled={isGeneratingPlan || selectedGeneratedPlan.isActive}
                      type="button"
                      onClick={handleGeneratePlan}
                    >
                      重新生成
                      <Sparkles size={16} aria-hidden="true" />
                    </button>
                    <p className="form-message">{planMessage}</p>
                  </div>
                </div>
              )}
            </section>
            <aside className="stack">
              {renderAiJobStatusPanel()}
              <section className="panel">
                <p className="eyebrow">Current goal</p>
                <div className="timeline-list">
                  <div>
                    <strong>目标状态</strong>
                    <span>{selectedGoalStatus}</span>
                  </div>
                  <div>
                    <strong>开始 / 结束</strong>
                    <span>
                      {selectedGoal
                        ? `${formatDate(selectedGoal.startDate)} - ${formatDate(
                            selectedGoal.endDate
                          )}`
                        : "待选择"}
                    </span>
                  </div>
                  <div>
                    <strong>每日投入</strong>
                    <span>
                      {selectedGoal?.dailyTimeBudgetMinutes
                        ? `${selectedGoal.dailyTimeBudgetMinutes} 分钟`
                        : "待估时"}
                    </span>
                  </div>
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Checklist</p>
                <div className="review-checklist">
                  <span>阶段目标是否清晰</span>
                  <span>每周节奏是否可执行</span>
                  <span>每日任务是否足够具体</span>
                  <span>投入时间是否符合现实约束</span>
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Replan</p>
                <h2>调整执行计划</h2>
                <form className="form-stack" onSubmit={handleRequestReplan}>
                  <label>
                    <span>调整原因</span>
                    <textarea
                      rows={3}
                      value={replanForm.adjustmentReason}
                      onChange={(event) =>
                        updateReplanField("adjustmentReason", event.target.value)
                      }
                      placeholder="例如：最近工作日时间被压缩，需要降低任务粒度"
                    />
                  </label>
                  <label>
                    <span>新的每日投入分钟</span>
                    <input
                      min="5"
                      max="600"
                      type="number"
                      value={replanForm.dailyTimeBudgetMinutes}
                      onChange={(event) =>
                        updateReplanField(
                          "dailyTimeBudgetMinutes",
                          event.target.value
                        )
                      }
                      placeholder={
                        selectedGoal?.dailyTimeBudgetMinutes
                          ? String(selectedGoal.dailyTimeBudgetMinutes)
                          : "30"
                      }
                    />
                  </label>
                  <label>
                    <span>新的限制条件</span>
                    <textarea
                      rows={3}
                      value={replanForm.constraints}
                      onChange={(event) =>
                        updateReplanField("constraints", event.target.value)
                      }
                      placeholder={selectedGoal?.constraints ?? "例如：只保留一个最小动作"}
                    />
                  </label>
                  <label>
                    <span>新的当前基础</span>
                    <textarea
                      rows={3}
                      value={replanForm.currentBaseline}
                      onChange={(event) =>
                        updateReplanField("currentBaseline", event.target.value)
                      }
                      placeholder={selectedGoal?.currentBaseline ?? "可选"}
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={
                      !session ||
                      !selectedGoal ||
                      !["ACTIVE", "AT_RISK", "REPLANNING"].includes(
                        selectedGoal.status
                      ) ||
                      isRequestingReplan
                    }
                    type="submit"
                  >
                    {isRequestingReplan ? "调整中" : "重新评估计划"}
                    <Sparkles size={16} aria-hidden="true" />
                  </button>
                </form>
              </section>
              <section className="panel">
                <p className="eyebrow">After confirm</p>
                <h2>进入执行状态</h2>
                <p className="muted-text">
                  确认后系统会把目标切换为执行中，今日任务、热力图和健康报告都会围绕该目标更新。
                </p>
              </section>
            </aside>
          </div>
        );
      case "today":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <p className="eyebrow">Daily work</p>
              <h1>今日任务</h1>
              <p className="form-message">{dailyTaskMessage}</p>
              {goalHealth && deviationLevel !== "stable" ? (
                <section className={`deviation-alert ${deviationLevel}`}>
                  <div>
                    <p className="eyebrow">Deviation alert</p>
                    <h2>
                      {deviationLevel === "danger" ? "目标偏差较高" : "目标出现偏差"}
                    </h2>
                    <p>
                      {deviationReasons.map((reason) => reason.label).join("、")}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    disabled={isGeneratingRescueTask}
                    type="button"
                    onClick={handleGenerateRescueTask}
                  >
                    {isGeneratingRescueTask ? "生成中" : "生成救援任务"}
                    <Sparkles size={16} aria-hidden="true" />
                  </button>
                </section>
              ) : null}
              {rescueTask ? (
                <section className="rescue-card">
                  <div>
                    <p className="eyebrow">Rescue task</p>
                    <h2>{rescueTask.title}</h2>
                    <p>{rescueTask.description}</p>
                    <span>
                      {rescueTask.estimatedMinutes} 分钟 · {rescueTask.reason}
                    </span>
                  </div>
                  <button
                    className="ghost-button"
                    disabled={rescueTask.status === "DONE"}
                    type="button"
                    onClick={() => openCompletionDialog(rescueTask as TodayDailyTask)}
                  >
                    {rescueTask.status === "DONE" ? "已完成" : "完成救援任务"}
                  </button>
                </section>
              ) : null}
              <div className="task-list">
                {visiblePlannedTasks.map((task, index) => (
                  <article
                    className={`task-row ${
                      task.taskType === "RESCUE" ? "rescue" : ""
                    }`}
                    key={task.id}
                  >
                    <span>{index + 1}</span>
                    <div>
                      <h2>{task.title}</h2>
                      <p>
                        {task.goalTitle}
                        {task.weeklyPlanTitle ? ` · ${task.weeklyPlanTitle}` : ""} ·{" "}
                        {task.plannedMinutes ? `${task.plannedMinutes} 分钟` : "待估时"} ·{" "}
                        {task.status === "DONE"
                          ? "已完成"
                          : task.taskType === "RESCUE"
                            ? "救援任务"
                            : "待完成"}
                      </p>
                      <p className="task-description">{task.description}</p>
                      {getStudyTaskMeta(task).length ? (
                        <div className="daily-task-chips">
                          {getStudyTaskMeta(task).map((meta) => (
                            <span key={meta}>{meta}</span>
                          ))}
                        </div>
                      ) : null}
                      {task.taskType === "RESCUE" && task.rescueReason ? (
                        <p className="task-rescue-reason">
                          触发原因：{task.rescueReason}
                        </p>
                      ) : null}
                      {task.latestCheckin ? (
                        <div className="task-result-inline">
                          <strong>
                            {task.latestCheckin.aiScore
                              ? `AI 评分 ${task.latestCheckin.aiScore.totalScore}`
                              : "已提交复盘"}
                          </strong>
                          <span>{formatDateTime(task.latestCheckin.submittedAt)}</span>
                          <p>{task.latestCheckin.aiScore?.suggestion ?? task.latestCheckin.content}</p>
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="ghost-button"
                      disabled={
                        isLoadingDailyTasks ||
                        completingTaskId === task.id ||
                        task.status === "DONE" ||
                        task.status === "PREVIEW"
                      }
                      onClick={() => openCompletionDialog(task as TodayDailyTask)}
                      type="button"
                    >
                      {task.status === "DONE"
                        ? "已完成"
                        : completingTaskId === task.id
                            ? "提交中"
                            : task.taskType === "RESCUE"
                              ? "完成救援"
                              : "完成"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Health</p>
                <div className="score-ring">
                  <strong>{goalHealth?.healthScore ?? "-"}</strong>
                  <span>健康度</span>
                </div>
                <div className="health-meta">
                  <span>
                    平均评分 {goalHealth?.averageScore ?? "-"}
                  </span>
                  <span>
                    近 7 天 {goalHealth?.recentInvestedMinutes ?? 0} 分钟
                  </span>
                </div>
                {goalHealth ? (
                  <p className="muted-text">
                    普通任务权重 {goalHealth.healthWeights.taskTypeWeights.normal}，
                    救援任务权重 {goalHealth.healthWeights.taskTypeWeights.rescue}。
                    今日快照 {goalHealth.snapshot.date} 已保存。
                  </p>
                ) : null}
              </section>
              <section className="panel">
                <p className="eyebrow">Signals</p>
                <div className="metric-grid">
                  {healthPanelMetrics.map((metric) => (
                    <div className={`metric-card ${metric.tone}`} key={metric.label}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Risk</p>
                <div className="risk-list">
                  {!goalHealth ? (
                    <div className="risk-card stable">
                      <strong>暂无健康数据</strong>
                      <p>确认计划并完成任务后会生成偏差提示。</p>
                      <span>先完成今日任务，系统会自动更新健康度。</span>
                    </div>
                  ) : goalHealth.risks.length ? (
                    goalHealth.risks.map((risk) => (
                      <article className={`risk-card ${risk.level}`} key={risk.title}>
                        <strong>{risk.title}</strong>
                        <p>{risk.detail}</p>
                        <span>{risk.suggestion}</span>
                      </article>
                    ))
                  ) : (
                    <div className="risk-card stable">
                      <strong>节奏稳定</strong>
                      <p>当前没有明显偏差提示。</p>
                      <span>继续完成今日任务并保持复盘质量。</span>
                    </div>
                  )}
                </div>
                {goalHealth ? (
                  <div className="rescue-actions">
                    <button
                      className="primary-button"
                      disabled={isGeneratingRescueTask}
                      type="button"
                      onClick={handleGenerateRescueTask}
                    >
                      {isGeneratingRescueTask ? "生成中" : "生成救援任务"}
                      <Sparkles size={16} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                {rescueTask ? (
                  <article className="risk-card stable">
                    <strong>{rescueTask.title}</strong>
                    <p>{rescueTask.description}</p>
                    <span>
                      已保存到今日任务 · {rescueTask.estimatedMinutes} 分钟 ·{" "}
                      {rescueTask.reason}
                    </span>
                  </article>
                ) : null}
              </section>
            </aside>
          </div>
        );
      case "heatmap":
        return (
          <div className="content-grid heatmap-view">
            <section className="panel main-panel">
              <div className="panel-heading heatmap-heading">
                <div>
                  <p className="eyebrow">Progress map</p>
                  <h1>成长热力图</h1>
                </div>
              </div>

              <div className="contribution-layout">
                <div className="contribution-main">
                  <div className="contribution-toolbar">
                    <h2>{heatmapContributionCount} 次成长记录 in {heatmapYear}</h2>
                    <span>Contribution settings</span>
                  </div>

                  <div className="calendar-heatmap" aria-label={`${heatmapYear} 年任务完成热力图`}>
                    <div
                      className="month-label-row"
                      style={{
                        gridTemplateColumns: `repeat(${contributionMap.weekCount}, var(--heat-cell-size))`
                      }}
                      aria-hidden="true"
                    >
                      {contributionMap.monthLabels.map((month) => (
                        <span
                          key={month.label}
                          style={{ gridColumnStart: month.column }}
                        >
                          {month.label}
                        </span>
                      ))}
                    </div>

                    <div className="contribution-grid-wrap">
                      <div className="weekday-axis" aria-hidden="true">
                        {contributionWeekdayLabels.map((label) => (
                          <span
                            key={label.label}
                            style={{ gridRowStart: label.row }}
                          >
                            {label.label}
                          </span>
                        ))}
                      </div>

                      <div
                        className="heatmap-grid"
                        style={{
                          gridTemplateColumns: `repeat(${contributionMap.weekCount}, var(--heat-cell-size))`
                        }}
                      >
                        {contributionMap.cells.map((cell) => (
                          <button
                            aria-label={`${formatActivityDate(cell.dateKey)}，强度 ${cell.level}`}
                            className={`heat-cell level-${cell.level} ${
                              cell.isOutsideYear ? "is-outside-year" : ""
                            } ${
                              cell.dateKey === selectedHeatmapDate ? "is-selected" : ""
                            }`}
                            disabled={cell.isOutsideYear}
                            key={cell.dateKey}
                            onClick={() => setSelectedHeatmapDate(cell.dateKey)}
                            title={`${formatActivityDate(cell.dateKey)} · 强度 ${cell.level}`}
                            type="button"
                          />
                        ))}
                      </div>
                    </div>

                    <div className="heatmap-footer">
                      <span>点击方块查看当天复盘</span>
                      <div className="heatmap-legend" aria-label="强度图例">
                        <span>Less</span>
                        {[0, 1, 2, 3, 4].map((level) => (
                          <span
                            className={`heat-cell level-${level}`}
                            key={level}
                          />
                        ))}
                        <span>More</span>
                      </div>
                    </div>
                  </div>

                  <section className="activity-panel" aria-live="polite">
                    <div className="activity-month-row">
                      <strong>{formatActivityMonth(selectedHeatmapDate)}</strong>
                      <span />
                    </div>
                    <div className="activity-summary">
                      <span>{formatActivityDate(selectedHeatmapDate)}</span>
                      <strong>
                        {selectedHeatmapTimelineItems.length || selectedHeatmapTasks.length} 条复盘记录
                      </strong>
                    </div>
                    <div className="activity-stats">
                      <span>{selectedHeatmapMinutes} 分钟投入</span>
                      <span>完成 {selectedHeatmapCompletionRate}%</span>
                      <span>
                        {selectedHeatmapAverageScore !== null
                          ? `AI 评分 ${selectedHeatmapAverageScore}`
                          : "暂无评分"}
                      </span>
                      <span>健康 {selectedHeatmapHealthScore}</span>
                      <span>强度 {selectedHeatmapLevel}</span>
                    </div>
                    <div className="activity-actions">
                      <button
                        className="ghost-button"
                        disabled={!selectedHeatmapTimelineItems.length}
                        type="button"
                        onClick={() => openTimelineDate(selectedHeatmapDate)}
                      >
                        查看当天时间线
                        <History size={16} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="activity-list">
                      {selectedHeatmapTimelineItems.length ? (
                        selectedHeatmapTimelineItems.map((item) => (
                          <article key={item.id}>
                            {item.kind === "DEVIATION" ? (
                              <ShieldCheck size={18} aria-hidden="true" />
                            ) : (
                              <CheckCircle2 size={18} aria-hidden="true" />
                            )}
                            <div>
                              <h2>{item.taskTitle}</h2>
                              <p>
                                {item.goalTitle}
                                {item.weeklyPlanTitle ? ` · ${item.weeklyPlanTitle}` : ""} ·{" "}
                                {item.kind === "DEVIATION"
                                  ? `风险 ${riskLevelLabels[item.rescueRiskLevel ?? "stable"]}`
                                  : `${item.investedMinutes ?? item.plannedMinutes ?? 0} 分钟`}{" "}
                                · {getTimelineBadge(item)}
                              </p>
                              <p>
                                {item.kind === "DEVIATION" ? "触发时间" : "完成时间"} ·{" "}
                                {formatDateTime(item.timelineAt)}
                              </p>
                              {item.checkin ? (
                                <div className="reflection-note">
                                  {item.checkin.content.split("\n").map((line, index) => (
                                    <span key={`${item.id}-reflection-${index}`}>{line}</span>
                                  ))}
                                </div>
                              ) : null}
                              {item.kind === "DEVIATION" && item.rescueTasks.length ? (
                                <div className="timeline-rescue-note">
                                  <strong>救援任务</strong>
                                  <span>
                                    {item.rescueTasks
                                      .map((task) => `${task.title}（${taskStatusLabels[task.status] ?? task.status}）`)
                                      .join("、")}
                                  </span>
                                </div>
                              ) : null}
                              {item.aiScore ? (
                                <div className="ai-advice-note">
                                  <strong>{item.aiScore.summary}</strong>
                                  <span>{item.aiScore.suggestion}</span>
                                </div>
                              ) : null}
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="empty-activity">
                          <span>暂无完成任务</span>
                          <p>这一天还没有提交打卡或完成记录。</p>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <aside className="year-switcher" aria-label="年份切换">
                  {heatmapYearOptions.map((year) => (
                    <button
                      className={year === heatmapYear ? "active" : ""}
                      key={year}
                      onClick={() => {
                        setHeatmapYear(year);
                        setSelectedHeatmapDate(toDateKey(new Date(year, 5, 8)));
                      }}
                      type="button"
                    >
                      {year}
                    </button>
                  ))}
                </aside>
              </div>
            </section>
          </div>
        );
      case "timeline":
        return (
          <div className="content-grid timeline-view">
            <section className="panel main-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Growth story</p>
                  <h1>成长时间线</h1>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => setActivePage("today")}
                >
                  今日任务
                  <CalendarCheck size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="form-message">{timelineMessage}</p>

              {timelineDays.length ? (
                <div className="growth-timeline">
                  {timelineDays.map((day) => (
                    <section
                      className={`timeline-day ${
                        day.date === selectedTimelineDate ? "is-focused" : ""
                      }`}
                      key={day.date}
                    >
                      <div className="timeline-date">
                        <strong>{formatActivityDate(day.date)}</strong>
                        <span>
                          {day.items.length} 条记录 · {day.investedMinutes} 分钟 ·{" "}
                          {day.averageScore !== null
                            ? `AI 均分 ${day.averageScore}`
                            : "暂无评分"}
                        </span>
                      </div>
                      <div className="timeline-records">
                        {day.items.map((item) => (
                          <article className="timeline-record" key={item.id}>
                            <div className="timeline-record-head">
                              <div>
                                <h2>{item.taskTitle}</h2>
                                <p>
                                  {item.goalTitle}
                                  {item.weeklyPlanTitle
                                    ? ` · ${item.weeklyPlanTitle}`
                                    : ""}{" "}
                                  · {formatDateTime(item.timelineAt)}
                                </p>
                              </div>
                              <strong>{getTimelineBadge(item)}</strong>
                            </div>
                            {item.kind === "DEVIATION" ? (
                              <div className="timeline-chain">
                                <div className="timeline-chain-step">
                                  <strong>触发偏差</strong>
                                  <span>
                                    {item.deviationReasons[0]?.detail ??
                                      item.rescueReason ??
                                      "系统检测到目标执行节奏偏离计划。"}
                                  </span>
                                  <div className="timeline-meta">
                                    <span>
                                      风险{" "}
                                      {riskLevelLabels[item.rescueRiskLevel ?? "stable"]}
                                    </span>
                                    {item.deviationReasons[0]?.label ? (
                                      <span>{item.deviationReasons[0].label}</span>
                                    ) : null}
                                    {item.sourceTask ? (
                                      <span>来源任务：{item.sourceTask.title}</span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="timeline-chain-step">
                                  <strong>系统介入</strong>
                                  {item.rescueTasks.length ? (
                                    <div className="timeline-rescue-stack">
                                      {item.rescueTasks.map((task) => (
                                        <div key={task.id}>
                                          <span>
                                            {task.title} ·{" "}
                                            {taskStatusLabels[task.status] ?? task.status}
                                          </span>
                                          <p>
                                            {task.rescueReason ?? task.description}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span>偏差事件已记录，等待生成救援任务。</span>
                                  )}
                                </div>
                                <div className="timeline-chain-step">
                                  <strong>救援任务完成</strong>
                                  {item.rescueTasks.some((task) => task.latestCheckin) ? (
                                    item.rescueTasks
                                      .filter((task) => task.latestCheckin)
                                      .map((task) => (
                                        <div className="timeline-rescue-complete" key={task.id}>
                                          <span>
                                            {task.completedAt
                                              ? formatDateTime(task.completedAt)
                                              : "已完成"}
                                            {task.latestCheckin?.investedMinutes
                                              ? ` · ${task.latestCheckin.investedMinutes} 分钟`
                                              : ""}
                                            {task.latestCheckin?.aiScore
                                              ? ` · AI ${task.latestCheckin.aiScore.totalScore}`
                                              : ""}
                                          </span>
                                          {task.latestCheckin?.aiScore ? (
                                            <p>{task.latestCheckin.aiScore.suggestion}</p>
                                          ) : null}
                                        </div>
                                      ))
                                  ) : (
                                    <span>救援任务尚未完成，完成后会在这里沉淀复盘和建议。</span>
                                  )}
                                </div>
                              </div>
                            ) : null}
                            {item.isRescueTask ? (
                              <div className="timeline-rescue-note">
                                <strong>救援任务复盘</strong>
                                <span>
                                  {item.rescueReason ?? "系统生成的补救动作已完成。"}
                                </span>
                              </div>
                            ) : null}
                            <div className="timeline-meta">
                              {item.kind === "CHECKIN" ? (
                                <>
                                  <span>投入 {item.investedMinutes ?? 0} 分钟</span>
                                  <span>
                                    {item.plannedMinutes
                                      ? `计划 ${item.plannedMinutes} 分钟`
                                      : "计划待估时"}
                                  </span>
                                  {item.isRescueTask ? (
                                    <span>补救效果已计入健康度和热力图</span>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <span>事件 {item.deviationEventId}</span>
                                  <span>{item.rescueTasks.length} 个关联救援任务</span>
                                </>
                              )}
                            </div>
                            {item.checkin ? (
                              <div className="reflection-note">
                                {item.checkin.content.split("\n").map((line, index) => (
                                  <span key={`${item.id}-line-${index}`}>{line}</span>
                                ))}
                              </div>
                            ) : null}
                            {item.aiScore ? (
                              <div className="ai-advice-note">
                                <strong>{item.aiScore.summary}</strong>
                                <span>{item.aiScore.suggestion}</span>
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <History size={24} aria-hidden="true" />
                  <h2>{isLoadingTimeline ? "正在加载时间线" : "暂无成长记录"}</h2>
                  <p>完成今日任务并提交复盘后，这里会按日期沉淀记录、评分和建议。</p>
                  <div className="form-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => setActivePage("today")}
                    >
                      去完成今日任务
                      <CalendarCheck size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Selected day</p>
                {selectedTimelineDay ? (
                  <div className="timeline-day-summary">
                    <h2>{formatActivityDate(selectedTimelineDay.date)}</h2>
                    <div className="metric-grid">
                      <div className="metric-card">
                        <span>复盘</span>
                        <strong>{selectedTimelineDay.items.length}</strong>
                      </div>
                      <div className="metric-card">
                        <span>投入</span>
                        <strong>{selectedTimelineDay.investedMinutes}</strong>
                      </div>
                    </div>
                    <span>
                      {selectedTimelineDay.averageScore !== null
                        ? `AI 平均评分 ${selectedTimelineDay.averageScore}`
                        : "暂无 AI 评分"}
                    </span>
                  </div>
                ) : (
                  <div className="empty-inline">
                    <span>未选中日期</span>
                    <p>从热力图点击日期或在时间线中查看最近记录。</p>
                  </div>
                )}
              </section>
              <section className="panel">
                <p className="eyebrow">Recent</p>
                {recentTimelineItems.length ? (
                  <div className="timeline-shortcuts">
                    {recentTimelineItems.map((item) => (
                      <button
                        className={
                          item.date === selectedTimelineDate ? "active" : ""
                        }
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedTimelineDate(item.date)}
                      >
                        <strong>{item.taskTitle}</strong>
                        <span>{formatActivityDate(item.date)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">暂无最近记录。</p>
                )}
              </section>
            </aside>
          </div>
        );
      case "rewards":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Reward board</p>
                  <h1>奖励愿景板</h1>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!session || !selectedGoalId || isLoadingRewards}
                  onClick={() => void loadRewardBoard()}
                >
                  刷新
                  <Gift size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="form-message">{rewardMessage}</p>

              {rewardCardsForGoal.length ? (
                <div className="reward-board-grid">
                  {rewardCardsForGoal.map((card) => (
                    <article className="reward-card reward-board-card" key={card.id}>
                      <div className="reward-card-head">
                        {card.cardType === "IMAGE" ? (
                          <Gift size={18} aria-hidden="true" />
                        ) : card.cardType === "LINK" ? (
                          <ChevronRight size={18} aria-hidden="true" />
                        ) : (
                          <Trophy size={18} aria-hidden="true" />
                        )}
                        <div>
                          <h2>{card.title}</h2>
                          <p>
                            {rewardSourceLabels[card.sourceType] ?? card.sourceType} ·{" "}
                            {rewardCardTypeLabels[card.cardType] ?? card.cardType}
                          </p>
                        </div>
                      </div>
                      {card.imageUrl ? (
                        <img
                          alt={card.title}
                          className="reward-card-image"
                          src={card.imageUrl}
                        />
                      ) : null}
                      {card.description ? <p>{card.description}</p> : null}
                      {card.linkUrl ? (
                        <a
                          className="reward-card-link"
                          href={card.linkUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          打开奖励链接
                        </a>
                      ) : null}
                      <div className="reward-card-actions">
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={card.sourceType !== "CUSTOM"}
                          onClick={() => void handleMoveRewardCard(card, -1)}
                        >
                          上移
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={card.sourceType !== "CUSTOM"}
                          onClick={() => void handleMoveRewardCard(card, 1)}
                        >
                          下移
                        </button>
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={card.sourceType !== "CUSTOM"}
                          onClick={() => void handleDeleteRewardCard(card)}
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Gift size={24} aria-hidden="true" />
                  <h2>{isLoadingRewards ? "正在加载奖励板" : "暂无奖励卡片"}</h2>
                  <p>填写最终奖励、阶段奖励，或添加自定义卡片来建立目标锚点。</p>
                </div>
              )}
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Anchor</p>
                <h2>
                  {rewardBoard?.finalReward ||
                    selectedGoal?.finalReward ||
                    goalForm.finalReward ||
                    "尚未填写奖励"}
                </h2>
                <p className="muted-text">
                  最终奖励和阶段奖励会自动同步为不可删除的锚点卡片。
                </p>
              </section>
              <section className="panel">
                <p className="eyebrow">New card</p>
                <form className="form-stack" onSubmit={handleCreateRewardCard}>
                  <label className="form-field">
                    <span>卡片标题</span>
                    <input
                      value={rewardForm.title}
                      onChange={(event) =>
                        updateRewardField("title", event.target.value)
                      }
                      placeholder="例如：买一本期待很久的书"
                    />
                  </label>
                  <label className="form-field">
                    <span>卡片类型</span>
                    <select
                      value={rewardForm.cardType}
                      onChange={(event) =>
                        updateRewardField("cardType", event.target.value)
                      }
                    >
                      <option value="TEXT">文字</option>
                      <option value="IMAGE">图片</option>
                      <option value="LINK">外链</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>描述</span>
                    <textarea
                      rows={3}
                      value={rewardForm.description}
                      onChange={(event) =>
                        updateRewardField("description", event.target.value)
                      }
                      placeholder="写下奖励的画面感或兑现条件"
                    />
                  </label>
                  <label className="form-field">
                    <span>图片地址</span>
                    <input
                      value={rewardForm.imageUrl}
                      onChange={(event) =>
                        updateRewardField("imageUrl", event.target.value)
                      }
                      placeholder="图片 URL，或选择本地图片"
                    />
                  </label>
                  <label className="form-field">
                    <span>上传图片</span>
                    <input
                      accept="image/*"
                      type="file"
                      onChange={(event) =>
                        handleRewardImageUpload(event.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  <label className="form-field">
                    <span>外链</span>
                    <input
                      value={rewardForm.linkUrl}
                      onChange={(event) =>
                        updateRewardField("linkUrl", event.target.value)
                      }
                      placeholder="奖励商品、相册或灵感链接"
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!session || !selectedGoalId}
                  >
                    添加奖励卡片
                    <Gift size={16} aria-hidden="true" />
                  </button>
                </form>
                <p className="muted-text">
                  自定义卡片 {customRewardCount}
                  {customRewardLimit ? ` / ${customRewardLimit}` : ""}。
                </p>
              </section>
            </aside>
          </div>
        );
      case "failure":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Failure report</p>
                  <h1>失败复盘</h1>
                </div>
                <button
                  className="ghost-button"
                  disabled={!session || !selectedGoalId || isLoadingFailureReport}
                  type="button"
                  onClick={() => void loadFailureReport()}
                >
                  刷新
                  <History size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="form-message">{failureMessage}</p>
              {failureReport ? (
                <div className="failure-report">
                  <section>
                    <p className="eyebrow">Reason</p>
                    <h2>失败原因分析</h2>
                    <p>{failureReport.reasonAnalysis}</p>
                  </section>
                  <section>
                    <p className="eyebrow">Timeline</p>
                    <h2>断签时间线</h2>
                    {failureReport.brokenStreakTimeline.length ? (
                      <div className="timeline-list">
                        {failureReport.brokenStreakTimeline.map((day) => (
                          <div key={day.date}>
                            <strong>{formatActivityDate(day.date)}</strong>
                            <span>
                              {day.taskCount} 个任务未恢复 ·{" "}
                              {day.pendingTaskTitles.join("、")}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">暂无断签记录。</p>
                    )}
                  </section>
                  <section>
                    <p className="eyebrow">Low score</p>
                    <h2>低分任务</h2>
                    {failureReport.lowScoreTasks.length ? (
                      <div className="timeline-list">
                        {failureReport.lowScoreTasks.map((task) => (
                          <div key={task.checkinId}>
                            <strong>{task.taskTitle}</strong>
                            <span>
                              {formatDateTime(task.submittedAt)}
                              {task.totalScore !== null ? ` · AI ${task.totalScore}` : ""}
                              {task.suggestion ? ` · ${task.suggestion}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">暂无低分任务。</p>
                    )}
                  </section>
                  <section>
                    <p className="eyebrow">Deviation</p>
                    <h2>关键偏差节点</h2>
                    {failureReport.keyDeviationNodes.length ? (
                      <div className="timeline-list">
                        {failureReport.keyDeviationNodes.map((node) => (
                          <div key={node.id}>
                            <strong>
                              {node.primaryReasonLabel ?? node.primaryReasonCode ?? "偏差"}
                            </strong>
                            <span>
                              {formatDateTime(node.detectedAt)} · {node.riskLevel}
                              {node.primaryReasonDetail
                                ? ` · ${node.primaryReasonDetail}`
                                : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">暂无偏差节点。</p>
                    )}
                  </section>
                  <section className="ai-advice-note">
                    <strong>AI 复盘建议</strong>
                    <span>{failureReport.suggestion}</span>
                  </section>
                </div>
              ) : (
                <div className="empty-state">
                  <ShieldCheck size={24} aria-hidden="true" />
                  <h2>{isLoadingFailureReport ? "正在加载失败复盘" : "暂无失败复盘"}</h2>
                  <p>目标进入失败状态后，系统会生成失败原因、断签时间线和重开建议。</p>
                </div>
              )}
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Restart</p>
                <h2>重新开启新目标</h2>
                <p className="muted-text">
                  重开会创建新的目标草稿，旧目标保留为历史参考。
                </p>
                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={!failureReport || isRestartingGoal}
                    type="button"
                    onClick={() => void handleRestartGoal()}
                  >
                    {isRestartingGoal ? "创建中" : "创建新目标"}
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Current</p>
                <div className="settings-list">
                  <div>
                    <span>当前目标</span>
                    <strong>{selectedGoal?.title ?? "未选择"}</strong>
                  </div>
                  <div>
                    <span>目标状态</span>
                    <strong>
                      {selectedGoal ? goalStatusLabels[selectedGoal.status] ?? selectedGoal.status : "-"}
                    </strong>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        );
      case "account":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <p className="eyebrow">Account</p>
              <h1>账号</h1>
              {session ? (
                <div className="signed-in">
                  <h2>{session.user.displayName ?? session.user.email}</h2>
                  <p>{session.user.membership?.plan ?? "FREE"} 计划</p>
                  <div className="metric-grid">
                    {accountQuotaMetrics.map(([label, quota]) => (
                      <div className="metric-card neutral" key={label}>
                        <span>{label}</span>
                        <strong>
                          {quota.used}/{quota.limit}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div className="data-export-box">
                    <div className="section-heading compact-heading">
                      <div>
                        <p className="eyebrow">Export</p>
                        <h3>数据导出</h3>
                      </div>
                      <select
                        value={dataExportForm.format}
                        onChange={(event) =>
                          setDataExportForm((current) => ({
                            ...current,
                            format: event.target.value as DataExportFormat
                          }))
                        }
                      >
                        {(["JSON", "CSV", "PDF", "EXCEL"] as DataExportFormat[]).map(
                          (format) => (
                            <option key={format} value={format}>
                              {format}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <label className="toggle-row">
                      <input
                        checked={dataExportForm.fullExport}
                        type="checkbox"
                        onChange={(event) =>
                          setDataExportForm((current) => ({
                            ...current,
                            fullExport: event.target.checked
                          }))
                        }
                      />
                      <span>一键完整导出</span>
                    </label>
                    <div className="export-scope-grid">
                      {dataExportScopeOptions.map((scope) => (
                        <label className="toggle-row" key={scope.code}>
                          <input
                            checked={
                              dataExportForm.fullExport ||
                              dataExportForm.scopes.includes(scope.code)
                            }
                            disabled={dataExportForm.fullExport}
                            type="checkbox"
                            onChange={() => toggleDataExportScope(scope.code)}
                          />
                          <span>{scope.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="form-actions">
                      <button
                        className="primary-button"
                        disabled={isExportingData}
                        type="button"
                        onClick={() => void handleExportCurrentAccountData()}
                      >
                        {isExportingData ? "导出中" : "生成导出"}
                        <Download size={16} aria-hidden="true" />
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!dataExportResult?.data && !dataExportResult?.download}
                        type="button"
                        onClick={downloadDataExportResult}
                      >
                        下载导出
                      </button>
                    </div>
                    {dataExportResult ? (
                      <div className="settings-list">
                        <div>
                          <span>{dataExportResult.exportId}</span>
                          <strong>{dataExportResult.status}</strong>
                        </div>
                        <div>
                          <span>{dataExportResult.scopes.join(" / ")}</span>
                          <strong>{dataExportResult.format}</strong>
                        </div>
                      </div>
                    ) : null}
                    <p className="form-message">{dataExportMessage}</p>
                  </div>
                  <div className="form-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleDeleteCurrentAccount()}
                    >
                      删除账号
                      <ShieldCheck size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : (
                <AuthPanel onAuthenticated={handleAuthenticated} />
              )}
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Email</p>
                <h2>提醒偏好</h2>
                {notificationPreference ? (
                  <div className="notification-form">
                    <label className="toggle-row">
                      <input
                        checked={notificationPreference.enabled}
                        type="checkbox"
                        onChange={(event) =>
                          updateNotificationPreferenceField(
                            "enabled",
                            event.target.checked
                          )
                        }
                      />
                      <span>开启邮件提醒</span>
                    </label>
                    <label>
                      <span>每日提醒时间</span>
                      <input
                        type="time"
                        value={notificationPreference.reminderTime}
                        onChange={(event) =>
                          updateNotificationPreferenceField(
                            "reminderTime",
                            event.target.value
                          )
                        }
                      />
                    </label>
                    <div className="reminder-type-list">
                      {notificationPreference.availableTypes.map((type) => (
                        <label className="toggle-row" key={type.code}>
                          <input
                            checked={notificationPreference.reminderTypes.includes(
                              type.code
                            )}
                            type="checkbox"
                            onChange={() => toggleReminderType(type.code)}
                          />
                          <span>{type.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="reminder-type-list">
                      {notificationPreference.availableChannels.map((channel) => (
                        <label className="toggle-row" key={channel.code}>
                          <input
                            checked={notificationPreference.channels.includes(
                              channel.code
                            )}
                            type="checkbox"
                            onChange={() => toggleNotificationChannel(channel.code)}
                          />
                          <span>{channel.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="settings-list">
                      <div>
                        <span>
                          微信绑定{" "}
                          {wechatBinding ? `· ${wechatBinding.openId}` : "· 未绑定"}
                        </span>
                        <strong>{wechatBinding?.status ?? "NONE"}</strong>
                      </div>
                    </div>
                    <div className="form-grid compact">
                      <label>
                        <span>微信 openId</span>
                        <input
                          value={wechatForm.openId}
                          onChange={(event) =>
                            updateWechatField("openId", event.target.value)
                          }
                          placeholder="预留小程序 openId"
                        />
                      </label>
                      <label>
                        <span>unionId</span>
                        <input
                          value={wechatForm.unionId}
                          onChange={(event) =>
                            updateWechatField("unionId", event.target.value)
                          }
                          placeholder="可选"
                        />
                      </label>
                    </div>
                    <label>
                      <span>微信昵称</span>
                      <input
                        value={wechatForm.nickname}
                        onChange={(event) =>
                          updateWechatField("nickname", event.target.value)
                        }
                        placeholder="可选"
                      />
                    </label>
                    <div className="form-actions">
                      <button
                        className="primary-button"
                        disabled={isSavingNotificationPreference}
                        type="button"
                        onClick={() => void handleSaveNotificationPreference()}
                      >
                        {isSavingNotificationPreference ? "保存中" : "保存提醒"}
                        <Bell size={16} aria-hidden="true" />
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() =>
                          void handleCreatePreviewEmailLog(
                            notificationPreference.reminderTypes[0]
                          )
                        }
                      >
                        写入预览日志
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleEnqueueDueEmailLogs()}
                      >
                        生成今日提醒
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleProcessQueuedEmailLogs()}
                      >
                        处理发送队列
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleRetryFailedEmailLogs()}
                      >
                        重试失败邮件
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleBindWechat()}
                      >
                        绑定微信
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleUnbindWechat()}
                      >
                        解绑微信
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="muted-text">进入账号页后会加载提醒偏好。</p>
                )}
                <p className="form-message">{notificationMessage}</p>
              </section>
              <section className="panel">
                <p className="eyebrow">Email logs</p>
                <h2>邮件日志</h2>
                {emailLogs.length ? (
                  <div className="settings-list">
                    {emailLogs.slice(0, 5).map((log) => (
                      <div key={log.id}>
                        <span>
                          {log.channel} · {log.subject} · 尝试 {log.attempts} 次
                        </span>
                        <strong>{log.status}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">暂无邮件日志。</p>
                )}
              </section>
            </aside>
          </div>
        );
      case "admin":
        if (!isAdminUser) {
          return (
            <div className="empty-state">
              <h2>后台管理仅管理员可见</h2>
              <p>普通用户账号不会显示后台入口，也不能访问后台数据。</p>
            </div>
          );
        }

        return (
          <div className="content-grid admin-grid">
            <section className="panel main-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Operations</p>
                  <h1>后台管理</h1>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!session || isLoadingAdmin}
                  onClick={() => void loadAdminDashboard()}
                >
                  {isLoadingAdmin ? "加载中" : "刷新"}
                  <ShieldCheck size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="form-message">{adminMessage}</p>

              {adminOverview ? (
                <div className="admin-sections">
                  <section>
                    <p className="eyebrow">Summary</p>
                    <div className="metric-grid admin-metric-grid">
                      {[
                        ["用户", adminOverview.metrics.users],
                        ["活跃目标", adminOverview.metrics.activeGoals],
                        ["风险目标", adminOverview.metrics.atRiskGoals],
                        ["失败 AI 任务", adminOverview.metrics.failedAiJobs],
                        ["排队 AI 任务", adminOverview.metrics.pendingAiJobs],
                        ["PRO 会员", adminOverview.metrics.proMemberships],
                        ["待发邮件", adminOverview.metrics.queuedEmails],
                        ["后台角色", adminOverview.admin.role]
                      ].map(([label, value]) => (
                        <div className="metric-card" key={label}>
                          <span>{label}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <p className="eyebrow">Goals</p>
                    <h2>目标状态</h2>
                    <form
                      className="admin-filter-form compact-admin-filter"
                      onSubmit={(event) => void handleSearchAdminGoals(event)}
                    >
                      <label>
                        <span>搜索</span>
                        <input
                          value={adminGoalFilters.query ?? ""}
                          onChange={(event) =>
                            updateAdminGoalFilter("query", event.target.value)
                          }
                          placeholder="目标、用户"
                        />
                      </label>
                      <label>
                        <span>状态</span>
                        <select
                          value={adminGoalFilters.status ?? ""}
                          onChange={(event) =>
                            updateAdminGoalFilter("status", event.target.value)
                          }
                        >
                          <option value="">全部</option>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="AT_RISK">AT_RISK</option>
                          <option value="REPLANNING">REPLANNING</option>
                          <option value="WAITING_CONFIRMATION">
                            WAITING_CONFIRMATION
                          </option>
                          <option value="COMPLETED">COMPLETED</option>
                          <option value="FAILED">FAILED</option>
                          <option value="GENERATION_FAILED">GENERATION_FAILED</option>
                        </select>
                      </label>
                      <label>
                        <span>分类</span>
                        <select
                          value={adminGoalFilters.category ?? ""}
                          onChange={(event) =>
                            updateAdminGoalFilter("category", event.target.value)
                          }
                        >
                          <option value="">全部</option>
                          <option value="STUDY">STUDY</option>
                          <option value="POSTGRAD_EXAM">POSTGRAD_EXAM</option>
                          <option value="CET_4_6">CET_4_6</option>
                          <option value="IELTS_TOEFL">IELTS_TOEFL</option>
                          <option value="GPA_IMPROVEMENT">GPA_IMPROVEMENT</option>
                          <option value="CERTIFICATION">CERTIFICATION</option>
                          <option value="CAREER">CAREER</option>
                          <option value="FITNESS">FITNESS</option>
                          <option value="HABIT">HABIT</option>
                          <option value="CUSTOM">CUSTOM</option>
                        </select>
                      </label>
                      <button
                        className="primary-button"
                        disabled={isLoadingAdmin}
                        type="submit"
                      >
                        筛选
                      </button>
                    </form>
                    <p className="muted-text">
                      当前显示 {adminGoals.length}/{adminGoalTotal} 个目标。
                    </p>
                    {adminGoals.length ? (
                      <div className="admin-table-list">
                        {adminGoals.slice(0, 8).map((goal) => (
                          <article key={goal.id}>
                            <div>
                              <strong>{goal.title}</strong>
                              <span>
                                {goal.userEmail} ·{" "}
                                {goalStatusLabels[goal.status] ?? goal.status}
                              </span>
                            </div>
                            <span>
                              任务 {goal.counts.dailyTasks} · 打卡{" "}
                              {goal.counts.checkins} · 偏差{" "}
                              {goal.counts.deviationEvents}
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">暂无目标数据。</p>
                    )}
                  </section>

                  <section>
                    <p className="eyebrow">AI jobs</p>
                    <h2>异步任务</h2>
                    <form
                      className="admin-filter-form compact-admin-filter"
                      onSubmit={(event) => void handleSearchAdminAiJobs(event)}
                    >
                      <label>
                        <span>搜索</span>
                        <input
                          value={adminAiJobFilters.query ?? ""}
                          onChange={(event) =>
                            updateAdminAiJobFilter("query", event.target.value)
                          }
                          placeholder="任务、目标、用户"
                        />
                      </label>
                      <label>
                        <span>状态</span>
                        <select
                          value={adminAiJobFilters.status ?? ""}
                          onChange={(event) =>
                            updateAdminAiJobFilter("status", event.target.value)
                          }
                        >
                          <option value="">全部</option>
                          <option value="QUEUED">QUEUED</option>
                          <option value="RUNNING">RUNNING</option>
                          <option value="RETRYING">RETRYING</option>
                          <option value="SUCCEEDED">SUCCEEDED</option>
                          <option value="FAILED">FAILED</option>
                          <option value="CANCELLED">CANCELLED</option>
                        </select>
                      </label>
                      <label>
                        <span>类型</span>
                        <input
                          value={adminAiJobFilters.type ?? ""}
                          onChange={(event) =>
                            updateAdminAiJobFilter("type", event.target.value)
                          }
                          placeholder="GOAL_PLAN_REPLAN"
                        />
                      </label>
                      <button
                        className="primary-button"
                        disabled={isLoadingAdmin}
                        type="submit"
                      >
                        筛选
                      </button>
                    </form>
                    <p className="muted-text">
                      当前显示 {adminAiJobs.length}/{adminAiJobTotal} 个 AI 任务。
                    </p>
                    {adminAiJobs.length ? (
                      <div className="admin-table-list">
                        {adminAiJobs.slice(0, 8).map((job) => (
                          <article key={job.id}>
                            <div>
                              <strong>{job.type}</strong>
                              <span>
                                {job.userEmail}
                                {job.goalTitle ? ` · ${job.goalTitle}` : ""}
                              </span>
                            </div>
                            <span>
                              {job.status} · {job.attempts} 次
                              {job.error ? ` · ${job.error}` : ""}
                            </span>
                            {job.status === "FAILED" ? (
                              <button
                                className="ghost-button"
                                disabled={adminRetryingAiJobId === job.id}
                                type="button"
                                onClick={() => void handleRetryAdminAiJob(job)}
                              >
                                {adminRetryingAiJobId === job.id ? "重试中" : "重试"}
                              </button>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">暂无 AI 任务。</p>
                    )}
                  </section>

                  <section>
                    <p className="eyebrow">Email</p>
                    <h2>邮件提醒日志</h2>
                    <form
                      className="admin-filter-form compact-admin-filter"
                      onSubmit={(event) => void handleSearchAdminEmailLogs(event)}
                    >
                      <label>
                        <span>搜索</span>
                        <input
                          value={adminEmailLogFilters.query ?? ""}
                          onChange={(event) =>
                            updateAdminEmailLogFilter("query", event.target.value)
                          }
                          placeholder="主题、收件人、用户"
                        />
                      </label>
                      <label>
                        <span>状态</span>
                        <select
                          value={adminEmailLogFilters.status ?? ""}
                          onChange={(event) =>
                            updateAdminEmailLogFilter("status", event.target.value)
                          }
                        >
                          <option value="">全部</option>
                          <option value="QUEUED">QUEUED</option>
                          <option value="SENT">SENT</option>
                          <option value="FAILED">FAILED</option>
                        </select>
                      </label>
                      <label>
                        <span>渠道</span>
                        <select
                          value={adminEmailLogFilters.channel ?? ""}
                          onChange={(event) =>
                            updateAdminEmailLogFilter("channel", event.target.value)
                          }
                        >
                          <option value="">全部</option>
                          <option value="EMAIL">EMAIL</option>
                          <option value="WECHAT">WECHAT</option>
                          <option value="WEB">WEB</option>
                        </select>
                      </label>
                      <label>
                        <span>类型</span>
                        <input
                          value={adminEmailLogFilters.type ?? ""}
                          onChange={(event) =>
                            updateAdminEmailLogFilter("type", event.target.value)
                          }
                          placeholder="DAILY_TASK"
                        />
                      </label>
                      <button
                        className="primary-button"
                        disabled={isLoadingAdmin}
                        type="submit"
                      >
                        筛选
                      </button>
                    </form>
                    <p className="muted-text">
                      当前显示 {adminEmailLogs.length}/{adminEmailLogTotal} 条日志。
                    </p>
                    {adminEmailLogs.length ? (
                      <div className="admin-table-list">
                        {adminEmailLogs.slice(0, 8).map((log) => (
                          <article key={log.id}>
                            <div>
                              <strong>{log.subject}</strong>
                              <span>{log.recipientEmail}</span>
                            </div>
                            <span>
                              {log.type} · {log.status} ·{" "}
                              {formatDateTime(log.createdAt)}
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">暂无邮件日志。</p>
                    )}
                  </section>

                  <section>
                    <p className="eyebrow">Audit</p>
                    <h2>审计日志</h2>
                    {adminAuditLogs.length ? (
                      <div className="admin-table-list">
                        {adminAuditLogs.slice(0, 8).map((log) => (
                          <article key={log.id}>
                            <div>
                              <strong>{log.action}</strong>
                              <span>
                                {log.actorEmail ?? "未知管理员"} ·{" "}
                                {formatDateTime(log.createdAt)}
                              </span>
                            </div>
                            <span>
                              {log.targetType}
                              {log.targetId ? ` · ${log.targetId}` : ""}
                              {log.reason ? ` · ${log.reason}` : ""}
                            </span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="muted-text">暂无审计日志。</p>
                    )}
                  </section>
                </div>
              ) : (
                <div className="empty-state">
                  <ShieldCheck size={24} aria-hidden="true" />
                  <h2>{isLoadingAdmin ? "正在加载后台" : "暂无后台数据"}</h2>
                  <p>当前登录账号需要存在有效管理员身份才能访问后台接口。</p>
                </div>
              )}
            </section>

            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Users</p>
                <h2>用户与会员</h2>
                <form
                  className="admin-filter-form"
                  onSubmit={(event) => void handleSearchAdminUsers(event)}
                >
                  <label>
                    <span>搜索</span>
                    <input
                      value={adminUserFilters.query ?? ""}
                      onChange={(event) =>
                        updateAdminUserFilter("query", event.target.value)
                      }
                      placeholder="邮箱或昵称"
                    />
                  </label>
                  <label>
                    <span>状态</span>
                    <select
                      value={adminUserFilters.status ?? ""}
                      onChange={(event) =>
                        updateAdminUserFilter("status", event.target.value)
                      }
                    >
                      <option value="">全部</option>
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="DISABLED">DISABLED</option>
                      <option value="DELETED">DELETED</option>
                    </select>
                  </label>
                  <label>
                    <span>会员</span>
                    <select
                      value={adminUserFilters.plan ?? ""}
                      onChange={(event) =>
                        updateAdminUserFilter("plan", event.target.value)
                      }
                    >
                      <option value="">全部</option>
                      <option value="FREE">FREE</option>
                      <option value="PRO">PRO</option>
                    </select>
                  </label>
                  <label>
                    <span>后台角色</span>
                    <select
                      value={adminUserFilters.adminRole ?? ""}
                      onChange={(event) =>
                        updateAdminUserFilter("adminRole", event.target.value)
                      }
                    >
                      <option value="">全部</option>
                      <option value="OPERATOR">OPERATOR</option>
                      <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                    </select>
                  </label>
                  <div className="form-actions">
                    <button
                      className="primary-button"
                      disabled={isLoadingAdmin}
                      type="submit"
                    >
                      搜索
                    </button>
                    <button
                      className="ghost-button"
                      disabled={isLoadingAdmin}
                      type="button"
                      onClick={() => void handleResetAdminUserFilters()}
                    >
                      清空
                    </button>
                  </div>
                </form>
                <p className="muted-text">当前显示 {adminUsers.length}/{adminUserTotal} 个用户。</p>
                {adminUsers.length ? (
                  <div className="admin-user-list">
                    {adminUsers.slice(0, 8).map((user) => (
                      <div key={user.id}>
                        <div>
                          <strong>{user.displayName ?? user.email}</strong>
                          <span>
                            {user.membership?.plan ?? "FREE"} ·{" "}
                            {user.membership?.status ?? "未开通"} · 目标{" "}
                            {user.counts.goals}
                          </span>
                        </div>
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={
                            adminMembershipUpdatingUserId === user.id ||
                            user.membership?.plan === "PRO"
                          }
                          onClick={() => void handleOpenProMembership(user.id)}
                        >
                          开通 PRO
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">暂无用户数据。</p>
                )}
              </section>

              <section className="panel">
                <p className="eyebrow">Raw view</p>
                <h2>敏感原文查看</h2>
                <div className="form-stack">
                  <label>
                    <span>目标用户</span>
                    <select
                      value={adminRawForm.userId}
                      onChange={(event) =>
                        setAdminRawForm((current) => ({
                          ...current,
                          userId: event.target.value
                        }))
                      }
                    >
                      <option value="">选择用户</option>
                      {adminUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>查看原因</span>
                    <textarea
                      rows={3}
                      value={adminRawForm.reason}
                      onChange={(event) =>
                        setAdminRawForm((current) => ({
                          ...current,
                          reason: event.target.value
                        }))
                      }
                      placeholder="例如：排查用户反馈中的评分争议"
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!session}
                    onClick={() => void handleLoadAdminRawContent()}
                  >
                    查看并审计
                    <ShieldCheck size={16} aria-hidden="true" />
                  </button>
                </div>
                {adminRawContent ? (
                  <div className="raw-content-preview">
                    <strong>{adminRawContent.user.email}</strong>
                    <span>{adminRawContent.goals.length} 个目标原文已加载</span>
                    {adminRawContent.goals.slice(0, 2).map((goal) => (
                      <p key={goal.id}>{goal.title}：{goal.description}</p>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="panel">
                <p className="eyebrow">Config</p>
                <h2>系统配置</h2>
                <div className="form-stack">
                  <label>
                    <span>键名</span>
                    <input
                      value={adminConfigForm.key}
                      onChange={(event) =>
                        updateAdminConfigField("key", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>JSON 值</span>
                    <textarea
                      rows={5}
                      value={adminConfigForm.value}
                      onChange={(event) =>
                        updateAdminConfigField("value", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>说明</span>
                    <input
                      value={adminConfigForm.description}
                      onChange={(event) =>
                        updateAdminConfigField("description", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>变更原因</span>
                    <input
                      value={adminConfigForm.reason}
                      onChange={(event) =>
                        updateAdminConfigField("reason", event.target.value)
                      }
                    />
                  </label>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!session || isSavingAdminConfig}
                    onClick={() => void handleSaveAdminConfig()}
                  >
                    {isSavingAdminConfig ? "保存中" : "保存配置"}
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </button>
                </div>
                {adminSystemConfigs.length ? (
                  <div className="settings-list admin-config-list">
                    {adminSystemConfigs.slice(0, 4).map((config) => (
                      <div key={config.id}>
                        <span>{config.key}</span>
                        <strong>{config.description ?? "无说明"}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted-text">暂无系统配置。</p>
                )}
              </section>
            </aside>
          </div>
        );
    }
  }

  return (
    <main className="app-shell">
      <section
        className={`workspace-panel ${isLabelNavCollapsed ? "nav-collapsed" : ""}`}
      >
        <aside className="app-sidebar" aria-label="功能标签">
          <div className="sidebar-header">
            <div className="brand">
              <span className="brand-mark">
                <Sparkles size={20} aria-hidden="true" />
              </span>
              <span>GoalPilot AI</span>
            </div>
            <button
              aria-expanded={!isLabelNavCollapsed}
              aria-label={isLabelNavCollapsed ? "展开功能标签" : "收起功能标签"}
              className="sidebar-toggle"
              data-testid="label-nav-toggle"
              type="button"
              onClick={() => setIsLabelNavCollapsed((current) => !current)}
            >
              {isLabelNavCollapsed ? (
                <PanelLeftOpen size={17} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={17} aria-hidden="true" />
              )}
            </button>
          </div>

          <button
            className="active-page-chip"
            data-testid="active-page-chip"
            type="button"
            onClick={() => setIsLabelNavCollapsed(false)}
          >
            <span>{activeNavItem.label}</span>
            <small>{activeNavItem.description}</small>
          </button>

          <nav className="label-nav">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={activePage === item.id ? "active" : ""}
                  key={item.id}
                  type="button"
                  onClick={() => setActivePage(item.id)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <Bell size={16} aria-hidden="true" />
            <span>邮件提醒</span>
          </div>
        </aside>

        <section className="page-surface">
          <header className="page-header">
            <div>
              <p>{activeNavItem.description}</p>
              <h2>{activeNavItem.label}</h2>
            </div>
          </header>
          {renderPage()}
        </section>
      </section>
      {completionTask ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="completion-dialog-title"
            aria-modal="true"
            className="completion-dialog"
            role="dialog"
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Daily check-in</p>
                <h2 id="completion-dialog-title">完成任务复盘</h2>
              </div>
              <button
                aria-label="关闭复盘弹窗"
                className="ghost-button"
                disabled={Boolean(completingTaskId)}
                type="button"
                onClick={closeCompletionDialog}
              >
                关闭
              </button>
            </div>
            <div className="dialog-task-summary">
              <strong>{completionTask.title}</strong>
              <span>
                {completionTask.goalTitle}
                {completionTask.weeklyPlanTitle
                  ? ` · ${completionTask.weeklyPlanTitle}`
                  : ""}{" "}
                ·{" "}
                {completionTask.plannedMinutes
                  ? `计划 ${completionTask.plannedMinutes} 分钟`
                  : "待估时"}
              </span>
              {completionTask.taskType === "RESCUE" && completionTask.rescueReason ? (
                <span>救援原因：{completionTask.rescueReason}</span>
              ) : null}
            </div>
            {completionResult ? (
              <div className="completion-result">
                <section className="score-result-card">
                  <div>
                    <p className="eyebrow">Mock AI score</p>
                    <h2>{completionResult.checkin.aiScore?.totalScore ?? "-"}</h2>
                    <span>
                      评分任务{" "}
                      {completionJobStatus
                        ? aiJobStatusLabels[completionJobStatus] ??
                          completionJobStatus
                        : "-"}
                    </span>
                  </div>
                  <CheckCircle2 size={28} aria-hidden="true" />
                </section>
                {renderAiJobStatusPanel()}
                <div className="reflection-note">
                  <strong>完成内容</strong>
                  <span>{completionResult.checkin.content}</span>
                </div>
                <div className="checkin-evidence-summary">
                  {completionResult.checkin.completedSubtasks.length ? (
                    <span>
                      子项 {completionResult.checkin.completedSubtasks.join("、")}
                    </span>
                  ) : null}
                  {completionResult.checkin.actualQuestionCount !== null ? (
                    <span>
                      题量 {completionResult.checkin.actualQuestionCount}
                      {completionResult.checkin.correctQuestionCount !== null
                        ? ` / 正确 ${completionResult.checkin.correctQuestionCount}`
                        : ""}
                    </span>
                  ) : null}
                  {completionResult.checkin.accuracy !== null ? (
                    <span>正确率 {completionResult.checkin.accuracy}%</span>
                  ) : null}
                  {completionResult.checkin.evidenceLinks.length ? (
                    <span>
                      证据链接 {completionResult.checkin.evidenceLinks.length} 条
                    </span>
                  ) : null}
                  {completionResult.checkin.evidenceFiles.length ? (
                    <span>
                      图片/文件 {completionResult.checkin.evidenceFiles.length} 条
                    </span>
                  ) : null}
                  {completionResult.checkin.studyMood ? (
                    <span>状态 {completionResult.checkin.studyMood}</span>
                  ) : null}
                  {completionResult.checkin.difficultyLevel ? (
                    <span>难度 {completionResult.checkin.difficultyLevel}</span>
                  ) : null}
                </div>
                {completionResult.checkin.aiScore ? (
                  <>
                    {completionResult.checkin.aiScore.isDetailedAnalysisUnlocked ? (
                      <>
                        <div className="score-dimensions">
                          {Object.entries(
                            completionResult.checkin.aiScore.dimensions ?? {}
                          ).map(([label, value]) => (
                            <span key={label}>
                              {label} <strong>{value}</strong>
                            </span>
                          ))}
                        </div>
                        <div className="reflection-note">
                          <strong>AI 总结</strong>
                          <span>{completionResult.checkin.aiScore.summary}</span>
                          <strong>明日建议</strong>
                          <span>{completionResult.checkin.aiScore.suggestion}</span>
                        </div>
                      </>
                    ) : (
                      <div className="reflection-note locked-analysis">
                        <strong>详细 AI 分析</strong>
                        <span>
                          免费版已记录基础评分。Pro 可查看维度评分、证据分析和明日建议。
                        </span>
                      </div>
                    )}
	                    <form className="score-appeal-form" onSubmit={handleAppealScore}>
	                      <strong>评分申诉复评</strong>
	                      <label>
	                        <span>申诉原因</span>
	                        <textarea
	                          rows={2}
	                          value={appealForm.reason}
	                          onChange={(event) =>
	                            updateAppealField("reason", event.target.value)
	                          }
	                          placeholder="例如：原复盘遗漏了关键证据。"
	                        />
	                      </label>
	                      <label>
	                        <span>新增事实或证据</span>
	                        <textarea
	                          rows={3}
	                          value={appealForm.addedFacts}
	                          onChange={(event) =>
	                            updateAppealField("addedFacts", event.target.value)
	                          }
	                          placeholder="补充具体产出、截图链接、数据、投入说明或遗漏信息。"
	                        />
	                      </label>
	                      <div className="form-actions">
	                        <button
	                          className="ghost-button"
	                          disabled={isSubmittingAppeal}
	                          type="submit"
	                        >
	                          {isSubmittingAppeal ? "复评中" : "提交申诉"}
	                        </button>
	                      </div>
	                      {appealResult ? (
	                        <span>
	                          {appealResult.status} · 原分 {appealResult.originalScore}
	                          {appealResult.newScore !== null
	                            ? ` · 复评分 ${appealResult.newScore}`
	                            : ""}
	                        </span>
	                      ) : null}
	                      {appealMessage ? <span>{appealMessage}</span> : null}
	                    </form>
	                  </>
	                ) : null}
                <div className="result-impact-grid">
                  <span>热力图已记录今日完成</span>
                  <span>健康度会随复盘和评分刷新</span>
                  <span>
                    投入 {completionResult.checkin.investedMinutes ?? 0} 分钟
                  </span>
                </div>
                <div className="form-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={closeCompletionDialog}
                  >
                    返回今日任务
                    <CalendarCheck size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => {
                      setActivePage("heatmap");
                      closeCompletionDialog();
                    }}
                  >
                    查看热力图
                    <LineChart size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <form className="completion-form" onSubmit={handleCompleteDailyTask}>
                <label>
                  <span>实际投入分钟</span>
                  <input
                    min={0}
                    type="number"
                    value={completionForm.investedMinutes}
                    onChange={(event) =>
                      updateCompletionField("investedMinutes", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>完成子项</span>
                  <textarea
                    rows={2}
                    value={completionForm.completedSubtasks}
                    onChange={(event) =>
                      updateCompletionField("completedSubtasks", event.target.value)
                    }
                    placeholder="每行一个子项，例如：阅读第 2 章、整理错题。"
                  />
                </label>
                <div className="form-grid compact">
                  <label>
                    <span>实际题量</span>
                    <input
                      min={0}
                      type="number"
                      value={completionForm.actualQuestionCount}
                      onChange={(event) =>
                        updateCompletionField(
                          "actualQuestionCount",
                          event.target.value
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>正确题数</span>
                    <input
                      min={0}
                      type="number"
                      value={completionForm.correctQuestionCount}
                      onChange={(event) =>
                        updateCompletionField(
                          "correctQuestionCount",
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>今天完成了什么</span>
                  <textarea
                    required
                    rows={3}
                    value={completionForm.completedContent}
                    onChange={(event) =>
                      updateCompletionField("completedContent", event.target.value)
                    }
                    placeholder="例如：完成第 1 章练习，整理了 3 条关键笔记。"
                  />
                </label>
                <label>
                  <span>图片或截图链接</span>
                  <textarea
                    rows={2}
                    value={completionForm.evidenceFiles}
                    onChange={(event) =>
                      updateCompletionField("evidenceFiles", event.target.value)
                    }
                    placeholder="可填写截图、图片或文件链接，每行一条。"
                  />
                </label>
                <label>
                  <span>错题 / 笔记链接</span>
                  <textarea
                    rows={2}
                    value={completionForm.evidenceLinks}
                    onChange={(event) =>
                      updateCompletionField("evidenceLinks", event.target.value)
                    }
                    placeholder="可填写错题本、笔记、文档或网盘链接，每行一条。"
                  />
                </label>
                <div className="form-grid compact">
                  <label>
                    <span>学习状态</span>
                    <input
                      value={completionForm.studyMood}
                      onChange={(event) =>
                        updateCompletionField("studyMood", event.target.value)
                      }
                      placeholder="例如：专注、疲惫、焦虑"
                    />
                  </label>
                  <label>
                    <span>主观难度</span>
                    <select
                      value={completionForm.difficultyLevel}
                      onChange={(event) =>
                        updateCompletionField("difficultyLevel", event.target.value)
                      }
                    >
                      <option value="">未选择</option>
                      <option value="EASY">简单</option>
                      <option value="MEDIUM">适中</option>
                      <option value="HARD">困难</option>
                    </select>
                  </label>
                </div>
                <label>
                  <span>遇到的问题</span>
                  <textarea
                    rows={2}
                    value={completionForm.blockers}
                    onChange={(event) =>
                      updateCompletionField("blockers", event.target.value)
                    }
                    placeholder="例如：概念理解慢，环境配置耗时。"
                  />
                </label>
                <label>
                  <span>明日调整</span>
                  <textarea
                    rows={2}
                    value={completionForm.tomorrowAdjustment}
                    onChange={(event) =>
                      updateCompletionField("tomorrowAdjustment", event.target.value)
                    }
                    placeholder="例如：先复习昨天卡点，再进入下一项任务。"
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="primary-button"
                    disabled={Boolean(completingTaskId)}
                    type="submit"
                  >
                    {completingTaskId ? "提交中" : "提交复盘"}
                    <CheckCircle2 size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="ghost-button"
                    disabled={Boolean(completingTaskId)}
                    type="button"
                    onClick={closeCompletionDialog}
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}

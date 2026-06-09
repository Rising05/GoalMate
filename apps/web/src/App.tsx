import { FormEvent, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Flame,
  Gift,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCircle
} from "lucide-react";
import { AuthPanel } from "./AuthPanel";
import {
  AuthResponse,
  ActivityDay,
  Goal,
  GoalHealth,
  GoalPlan,
  TodayDailyTask,
  confirmGoalPlan,
  completeDailyTask,
  createGoal,
  fetchGoalHealth,
  fetchTaskActivity,
  fetchTodayTasks,
  generateGoalPlan,
  listGoals
} from "./api";

type PageId = "create" | "goals" | "today" | "heatmap" | "rewards" | "account";

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
    id: "rewards",
    label: "奖励愿景板",
    description: "Reward board",
    icon: Gift
  },
  {
    id: "account",
    label: "账号",
    description: "Account",
    icon: UserCircle
  }
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
    title: "阅读核心资料",
    description: "AI 计划生成并确认后，这里会显示当天真实任务。",
    plannedMinutes: 45,
    status: "PREVIEW",
    latestCheckin: null
  },
  {
    id: "preview-2",
    goalTitle: "计划待生成",
    title: "输出学习笔记",
    description: "完成按钮会在真实任务生成后启用。",
    plannedMinutes: 20,
    status: "PREVIEW",
    latestCheckin: null
  },
  {
    id: "preview-3",
    goalTitle: "计划待生成",
    title: "提交今日复盘",
    description: "完成后会写入 checkin 并更新热力图。",
    plannedMinutes: 10,
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

const rewardCards = [
  { title: "阶段奖励", detail: "第 30 天：一次认真休息", icon: Trophy },
  { title: "最终奖励", detail: "目标完成：兑现愿望卡片", icon: Flame },
  { title: "愿景素材", detail: "图片和外链待接入", icon: Gift }
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
  const [goalMessage, setGoalMessage] = useState("登录后可保存目标草稿。");
  const [planMessage, setPlanMessage] = useState("保存目标后可生成 AI 计划。");
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [isConfirmingPlan, setIsConfirmingPlan] = useState(false);
  const [todayTasks, setTodayTasks] = useState<TodayDailyTask[]>([]);
  const [activityDays, setActivityDays] = useState<ActivityDay[]>([]);
  const [goalHealth, setGoalHealth] = useState<GoalHealth | null>(null);
  const [dailyTaskMessage, setDailyTaskMessage] = useState("登录后可查看今日任务。");
  const [isLoadingDailyTasks, setIsLoadingDailyTasks] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completionTask, setCompletionTask] = useState<TodayDailyTask | null>(null);
  const [completionForm, setCompletionForm] = useState({
    investedMinutes: "",
    completedContent: "",
    blockers: "",
    tomorrowAdjustment: ""
  });

  const activeNavItem =
    navItems.find((item) => item.id === activePage) ?? navItems[0];
  const selectedGoal =
    goals.find((goal) => goal.id === selectedGoalId) ??
    (createdGoal?.id === selectedGoalId ? createdGoal : null);
  const selectedGeneratedPlan =
    generatedPlan && generatedPlan.goalId === selectedGoalId ? generatedPlan : null;
  const contributionMap = getYearContributionMap(heatmapYear, activityDays);
  const heatmapYearOptions = [new Date().getFullYear(), new Date().getFullYear() - 1];
  const selectedActivityDay = activityDays.find(
    (day) => day.date === selectedHeatmapDate
  );
  const selectedHeatmapTasks = selectedActivityDay?.tasks ?? [];
  const selectedHeatmapMinutes = selectedActivityDay?.investedMinutes ?? 0;
  const selectedHeatmapAverageScore = selectedActivityDay?.averageScore ?? null;
  const selectedHeatmapLevel = selectedActivityDay?.level ?? 0;
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
        }
      ]
    : healthMetrics;
  const visiblePlannedTasks =
    todayTasks.length > 0
      ? todayTasks
      : selectedGeneratedPlan
        ? selectedGeneratedPlan.weeklyPlans
            .flatMap((weeklyPlan) => weeklyPlan.dailyTasks)
            .slice(0, 3)
            .map((task) => ({
              id: task.id,
              goalTitle: selectedGeneratedPlan.summary,
              title: task.title,
              description: task.description,
              plannedMinutes: task.plannedMinutes,
              status: task.status,
              latestCheckin: null
            }))
        : plannedTasks;
  const todayCompletedCount = todayTasks.filter((task) => task.status === "DONE").length;
  const todayTaskCount = todayTasks.length;
  const selectedPlanTaskCount =
    selectedGeneratedPlan?.weeklyPlans.reduce(
      (count, weeklyPlan) => count + weeklyPlan.dailyTasks.length,
      0
    ) ?? 0;
  const selectedGoalStatus =
    selectedGoal ? goalStatusLabels[selectedGoal.status] ?? selectedGoal.status : "待选择";
  const dashboardAction = getDashboardAction();
  const goalPlaceholders =
    categoryExamples[goalForm.category] ?? categoryExamples.custom;

  useEffect(() => {
    if (!session) {
      setGoals([]);
      setSelectedGoalId(null);
      setTodayTasks([]);
      setActivityDays([]);
      setGoalHealth(null);
      setDailyTaskMessage("登录后可查看今日任务。");
      return;
    }

    void refreshGoals(session.token);
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    void refreshDailyTaskData(session.token, heatmapYear, selectedGoalId ?? undefined);
  }, [session, heatmapYear, selectedGoalId]);

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
        label: isConfirmingPlan ? "确认中" : "确认计划",
        description: "确认后目标进入执行状态，并生成今天可执行的任务。",
        icon: CheckCircle2,
        disabled: isConfirmingPlan || !selectedGeneratedPlan,
        run: handleConfirmPlan
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
      icon: LineChart,
      disabled: false,
      run: () => setActivePage("heatmap")
    };
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

    try {
      const [todayResponse, activityResponse] = await Promise.all([
        fetchTodayTasks(token, goalId),
        fetchTaskActivity(token, year, goalId)
      ]);
      const healthGoalId =
        goalId ??
        currentGoalId ??
        todayResponse.tasks.find((task) => task.status !== "PREVIEW")?.goalId;

      setTodayTasks(todayResponse.tasks);
      setActivityDays(activityResponse.days);
      if (healthGoalId) {
        setGoalHealth(await fetchGoalHealth(token, healthGoalId));
      } else {
        setGoalHealth(null);
      }
      setDailyTaskMessage(
        todayResponse.tasks.length
          ? `今日有 ${todayResponse.tasks.length} 个计划任务。`
          : "今天暂无可执行任务，请先确认 AI 计划。"
      );
    } catch (error) {
      setDailyTaskMessage(
        error instanceof Error ? error.message : "任务数据加载失败"
      );
    } finally {
      setIsLoadingDailyTasks(false);
    }
  }

  function openCompletionDialog(task: TodayDailyTask) {
    setCompletionTask(task);
    setCompletionForm({
      investedMinutes: task.plannedMinutes ? String(task.plannedMinutes) : "",
      completedContent: "",
      blockers: "",
      tomorrowAdjustment: ""
    });
  }

  function closeCompletionDialog() {
    if (completingTaskId) {
      return;
    }

    setCompletionTask(null);
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
      await completeDailyTask(session.token, completionTask.id, {
        content,
        investedMinutes
      });
      setDailyTaskMessage("任务已完成，热力图已更新。");
      await refreshDailyTaskData(session.token, heatmapYear);
      setSelectedHeatmapDate(completionTask.date);
      setCompletionTask(null);
    } catch (error) {
      setDailyTaskMessage(
        error instanceof Error ? error.message : "任务完成提交失败"
      );
    } finally {
      setCompletingTaskId(null);
    }
  }

  function updateGoalField(field: keyof typeof goalForm, value: string) {
    setGoalForm((current) => ({
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
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "AI 计划生成失败");
    } finally {
      setIsGeneratingPlan(false);
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
                      onClick={() => setActivePage("rewards")}
                    >
                      奖励愿景板
                      <Gift size={16} aria-hidden="true" />
                    </button>
                  </div>

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
      case "today":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <p className="eyebrow">Daily work</p>
              <h1>今日任务</h1>
              <p className="form-message">{dailyTaskMessage}</p>
              <div className="task-list">
                {visiblePlannedTasks.map((task, index) => (
                  <article className="task-row" key={task.id}>
                    <span>{index + 1}</span>
                    <div>
                      <h2>{task.title}</h2>
                      <p>
                        {task.goalTitle} ·{" "}
                        {task.plannedMinutes ? `${task.plannedMinutes} 分钟` : "待估时"} ·{" "}
                        {task.status === "DONE" ? "已完成" : "待完成"}
                      </p>
                      {task.latestCheckin ? (
                        <p className="task-checkin-summary">
                          {task.latestCheckin.aiScore
                            ? `AI 评分 ${task.latestCheckin.aiScore.totalScore}`
                            : "已提交复盘"}{" "}
                          · {formatDateTime(task.latestCheckin.submittedAt)}
                        </p>
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
                      <span>点击方块查看当天任务</span>
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
                      <strong>{selectedHeatmapTasks.length} 个已完成任务</strong>
                    </div>
                    <div className="activity-stats">
                      <span>{selectedHeatmapMinutes} 分钟投入</span>
                      <span>
                        {selectedHeatmapAverageScore !== null
                          ? `AI 评分 ${selectedHeatmapAverageScore}`
                          : "暂无评分"}
                      </span>
                      <span>强度 {selectedHeatmapLevel}</span>
                    </div>
                    <div className="activity-list">
                      {selectedHeatmapTasks.length ? (
                        selectedHeatmapTasks.map((task) => (
                          <article key={task.id}>
                            <CheckCircle2 size={18} aria-hidden="true" />
                            <div>
                              <h2>{task.title}</h2>
                              <p>
                                {task.goalTitle} ·{" "}
                                {task.investedMinutes ?? task.plannedMinutes ?? 0} 分钟 ·{" "}
                                {task.aiScore ? `AI 评分 ${task.aiScore}` : "暂无评分"}
                              </p>
                              {task.completedAt ? (
                                <p>完成时间 · {formatDateTime(task.completedAt)}</p>
                              ) : null}
                              {task.reflection ? (
                                <div className="reflection-note">
                                  {task.reflection.split("\n").map((line, index) => (
                                    <span key={`${line}-${index}`}>{line}</span>
                                  ))}
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
      case "rewards":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <p className="eyebrow">Reward board</p>
              <h1>奖励愿景板</h1>
              <div className="reward-grid">
                {rewardCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <article className="reward-card" key={card.title}>
                      <Icon size={18} aria-hidden="true" />
                      <div>
                        <h2>{card.title}</h2>
                        <p>{card.detail}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Anchor</p>
                <h2>{goalForm.finalReward || "尚未填写奖励"}</h2>
                <p className="muted-text">保存目标后会和目标草稿关联。</p>
              </section>
              <section className="panel">
                <p className="eyebrow">Board</p>
                <div className="board-slots">
                  <span>文字卡片</span>
                  <span>图片卡片</span>
                  <span>外链卡片</span>
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
                </div>
              ) : (
                <AuthPanel onAuthenticated={setSession} />
              )}
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Email</p>
                <h2>提醒</h2>
                <div className="settings-list">
                  <div>
                    <span>每日任务提醒</span>
                    <strong>09:00</strong>
                  </div>
                  <div>
                    <span>未打卡提醒</span>
                    <strong>21:00</strong>
                  </div>
                  <div>
                    <span>容错风险提醒</span>
                    <strong>开启</strong>
                  </div>
                </div>
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
            {navItems.map((item) => {
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
                {completionTask.goalTitle} ·{" "}
                {completionTask.plannedMinutes
                  ? `计划 ${completionTask.plannedMinutes} 分钟`
                  : "待估时"}
              </span>
            </div>
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
          </section>
        </div>
      ) : null}
    </main>
  );
}

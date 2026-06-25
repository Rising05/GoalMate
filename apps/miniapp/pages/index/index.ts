import { fetchGoals, fetchTodayTasks, Goal, TodayDailyTask } from "../../utils/api";

const app = getApp<IAppOption>();

Page({
  data: {
    goals: [] as Goal[],
    goalNames: [] as string[],
    selectedGoalIndex: 0,
    currentGoal: null as Goal | null,
    currentGoalName: "",
    tasks: [] as TodayDailyTask[],
    todayDateStr: "",
    todayWeekday: "",
    loading: true,
  },

  onShow() {
    if (!app.globalData.isLoggedIn) {
      wx.redirectTo({ url: "/pages/login/login" });
      return;
    }
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const today = new Date();
      this.setData({
        todayDateStr: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`,
        todayWeekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][today.getDay()],
      });

      const goals = await fetchGoals();
      const activeGoals = goals.filter((g) => g.status === "ACTIVE");

      if (activeGoals.length === 0) {
        this.setData({ goals, tasks: [], loading: false });
        return;
      }

      // Pick first active goal or "all"
      const selectedGoalIndex = 0;
      const currentGoal = activeGoals[selectedGoalIndex] || null;

      const tasks = await fetchTodayTasks(currentGoal?.id);

      this.setData({
        goals: activeGoals,
        goalNames: ["全部目标", ...activeGoals.map((g) => g.title)],
        selectedGoalIndex,
        currentGoal,
        currentGoalName: currentGoal?.title || "全部目标",
        tasks,
        loading: false,
      });
    } catch (err) {
      console.error("Failed to load tasks:", err);
      this.setData({ loading: false });
      wx.showToast({ title: "加载失败", icon: "none" });
    }
  },

  onGoalChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    const goals = this.data.goals;

    if (index === 0) {
      // "All goals"
      this.setData({ selectedGoalIndex: 0, currentGoal: null, currentGoalName: "全部目标" });
      this.loadTasksForGoal(undefined);
    } else {
      const goal = goals[index - 1];
      this.setData({ selectedGoalIndex: index, currentGoal: goal, currentGoalName: goal.title });
      this.loadTasksForGoal(goal.id);
    }
  },

  async loadTasksForGoal(goalId?: string) {
    this.setData({ loading: true });
    try {
      const tasks = await fetchTodayTasks(goalId);
      this.setData({ tasks, loading: false });
    } catch (err) {
      console.error("Failed to load tasks for goal:", err);
      this.setData({ loading: false });
    }
  },

  goToCheckin(e: WechatMiniprogram.TouchEvent) {
    const taskId = e.currentTarget.dataset.taskid as string;
    const goalId = e.currentTarget.dataset.goalid as string;
    const goalTitle = e.currentTarget.dataset.goaltitle as string;
    wx.navigateTo({
      url: `/pages/checkin/checkin?taskId=${taskId}&goalId=${goalId}&goalTitle=${encodeURIComponent(goalTitle)}`,
    });
  },
});

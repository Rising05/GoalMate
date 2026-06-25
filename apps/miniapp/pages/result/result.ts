import { fetchTaskDetail, TodayDailyTask } from "../../utils/api";

Page({
  data: {
    checkinSuccess: false,
    taskId: "",
    goalId: "",
    scoring: false,
    score: null as number | null,
    scoreSummary: "",
    errorMsg: "",
  },

  onLoad(options: Record<string, string>) {
    const success = options.checkinSuccess === "true";
    this.setData({
      checkinSuccess: success,
      taskId: options.taskId || "",
      goalId: options.goalId || "",
    });

    if (success && options.taskId) {
      this.pollForScore(options.taskId);
    }
  },

  async pollForScore(taskId: string) {
    this.setData({ scoring: true });

    // Poll up to 10 times (20 seconds total)
    for (let i = 0; i < 10; i++) {
      await delay(2000);
      try {
        const task = await fetchTaskDetail(taskId);
        if (task.latestCheckin?.aiScore) {
          const aiScore = task.latestCheckin.aiScore;
          this.setData({
            scoring: false,
            score: aiScore.totalScore,
            scoreSummary: aiScore.summary || "",
          });
          return;
        }
      } catch {
        // Continue polling
      }
    }

    this.setData({ scoring: false });
  },

  goToTasks() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  goToTaskDetail() {
    wx.redirectTo({
      url: `/pages/checkin/checkin?taskId=${this.data.taskId}&goalId=${this.data.goalId}`,
    });
  },
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

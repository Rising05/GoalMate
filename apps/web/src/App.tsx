import { FormEvent, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarCheck,
  ChevronRight,
  Flame,
  Gift,
  HeartHandshake,
  LineChart,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  Trophy
} from "lucide-react";
import { AuthPanel } from "./AuthPanel";
import { AuthResponse, Goal, createGoal } from "./api";

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
    label: "目标草稿",
    description: "Draft goals",
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
    icon: HeartHandshake
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

const heatmapCells = [
  0, 2, 1, 3, 4, 0, 1, 2, 4, 3, 2, 0, 1, 4, 4, 2, 3, 1, 0, 2, 3, 4, 2, 1,
  3, 0, 4, 2
];

const healthMetrics = [
  { label: "完成率", value: "0%", tone: "neutral" },
  { label: "平均分", value: "-", tone: "neutral" },
  { label: "容错剩余", value: "3", tone: "good" },
  { label: "连续天数", value: "0", tone: "neutral" }
];

const plannedTasks = [
  { title: "阅读核心资料", meta: "45 分钟 · 待生成" },
  { title: "输出学习笔记", meta: "20 分钟 · 待生成" },
  { title: "提交今日复盘", meta: "10 分钟 · 待打卡" }
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

export function App() {
  const [activePage, setActivePage] = useState<PageId>("create");
  const [isLabelNavCollapsed, setIsLabelNavCollapsed] = useState(false);
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [createdGoal, setCreatedGoal] = useState<Goal | null>(null);
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
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);

  const activeNavItem =
    navItems.find((item) => item.id === activePage) ?? navItems[0];

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
      setGoalMessage(`目标草稿已保存：${response.goal.title}`);
      setActivePage("goals");
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : "目标创建失败");
    } finally {
      setIsCreatingGoal(false);
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
                    placeholder="90 天完成 React 项目"
                  />
                </label>

                <label>
                  <span>目标描述</span>
                  <textarea
                    value={goalForm.description}
                    onChange={(event) =>
                      updateGoalField("description", event.target.value)
                    }
                    placeholder="系统学习 React，并完成一个可展示的项目"
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
                      placeholder="60"
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
                      placeholder="了解基础 HTML/CSS"
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
                    placeholder="工作日晚上 1 小时"
                  />
                </label>

                <label>
                  <span>完成奖励</span>
                  <input
                    value={goalForm.finalReward}
                    onChange={(event) =>
                      updateGoalField("finalReward", event.target.value)
                    }
                    placeholder="买一把喜欢的键盘"
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
                <h2>草稿</h2>
                <p className="muted-text">
                  AI 计划生成会在下一轮接入，目标将从 DRAFT 进入
                  GENERATING_PLAN。
                </p>
              </section>
            </aside>
          </div>
        );
      case "goals":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <p className="eyebrow">Draft goals</p>
              <h1>目标草稿</h1>
              {createdGoal ? (
                <article className="record-card">
                  <div>
                    <h2>{createdGoal.title}</h2>
                    <p>{createdGoal.description}</p>
                  </div>
                  <div className="metric-row">
                    <span>{createdGoal.status}</span>
                    <span>{createdGoal.category}</span>
                    <span>容错 {createdGoal.toleranceDaysAllowed} 天</span>
                  </div>
                </article>
              ) : (
                <div className="empty-state">
                  <ShieldCheck size={24} aria-hidden="true" />
                  <h2>暂无目标草稿</h2>
                  <p>保存目标后会显示在这里。</p>
                </div>
              )}
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Health</p>
                <div className="metric-grid">
                  {healthMetrics.map((metric) => (
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
                  {timelineItems.map((item) => (
                    <div key={item.title}>
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
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
              <div className="task-list">
                {plannedTasks.map((task, index) => (
                  <article className="task-row" key={task.title}>
                    <span>{index + 1}</span>
                    <div>
                      <h2>{task.title}</h2>
                      <p>{task.meta}</p>
                    </div>
                    <button className="ghost-button" type="button">
                      查看
                    </button>
                  </article>
                ))}
              </div>
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Score</p>
                <div className="score-ring">
                  <strong>-</strong>
                  <span>AI 评分</span>
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Flow</p>
                <div className="mini-flow">
                  {journeySteps.map((step) => {
                    const Icon = step.icon;
                    return (
                      <div key={step.title}>
                        <Icon size={16} aria-hidden="true" />
                        <span>{step.title}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </aside>
          </div>
        );
      case "heatmap":
        return (
          <div className="content-grid">
            <section className="panel main-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Progress map</p>
                  <h1>成长热力图</h1>
                </div>
                <span>28 天</span>
              </div>
              <div className="heatmap" aria-label="任务完成热力图预览">
                {heatmapCells.map((level, index) => (
                  <span
                    key={`${level}-${index}`}
                    className={`heat-cell level-${level}`}
                  />
                ))}
              </div>
            </section>
            <aside className="stack">
              <section className="panel">
                <p className="eyebrow">Legend</p>
                <div className="legend-list">
                  {[0, 1, 2, 3, 4].map((level) => (
                    <div key={level}>
                      <span className={`heat-cell level-${level}`} />
                      <span>强度 {level}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Signals</p>
                <div className="signal-list">
                  <span>AI 总评分</span>
                  <span>完成比例</span>
                  <span>投入时长</span>
                  <span>目标健康度</span>
                </div>
              </section>
            </aside>
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
                <HeartHandshake size={20} aria-hidden="true" />
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
    </main>
  );
}

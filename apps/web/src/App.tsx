import { useState } from "react";
import {
  Bell,
  CalendarCheck,
  ChevronRight,
  Flame,
  HeartHandshake,
  LineChart,
  ShieldCheck,
  Sparkles,
  Trophy
} from "lucide-react";
import { AuthPanel } from "./AuthPanel";
import { AuthResponse } from "./api";

const setupFields = [
  "目标描述",
  "开始与结束日期",
  "每日可投入时间",
  "当前基础",
  "容错次数",
  "完成后奖励"
];

const journeySteps = [
  {
    title: "AI 拆解计划",
    text: "从长期目标生成阶段里程碑、每周计划和每日任务。",
    icon: Sparkles
  },
  {
    title: "每日打卡评分",
    text: "用户提交文本复盘后，AI 按固定 rubric 给出多维评分。",
    icon: CalendarCheck
  },
  {
    title: "偏差与救援",
    text: "低分、断签和延期会触发提醒，必要时生成更小的救援任务。",
    icon: ShieldCheck
  },
  {
    title: "成长可视化",
    text: "热力图、健康报告和时间线持续记录目标执行状态。",
    icon: LineChart
  }
];

const heatmapCells = [
  0, 2, 1, 3, 4, 0, 1, 2, 4, 3, 2, 0, 1, 4, 4, 2, 3, 1, 0, 2, 3, 4, 2, 1,
  3, 0, 4, 2
];

export function App() {
  const [session, setSession] = useState<AuthResponse | null>(null);

  return (
    <main className="app-shell">
      <section className="guide-panel" aria-labelledby="goal-title">
        <div className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <HeartHandshake size={22} aria-hidden="true" />
            </span>
            <span>GoalPilot AI</span>
          </div>
          <button className="ghost-button" type="button">
            <Bell size={18} aria-hidden="true" />
            提醒设置
          </button>
        </div>

        <div className="content-grid">
          <div className="create-column">
            <p className="eyebrow">创建目标引导</p>
            <h1 id="goal-title">把一个长期目标，变成每天能执行的一小步。</h1>
            <p className="intro">
              先填写关键约束，AI 会判断目标可行性并生成计划。计划确认后才进入执行状态。
            </p>

            <form className="goal-card">
              <label>
                <span>我想完成的目标</span>
                <textarea
                  placeholder="例如：90 天系统学习 React，并完成一个可展示的项目"
                  rows={4}
                />
              </label>

              <div className="form-row">
                <label>
                  <span>开始日期</span>
                  <input type="date" />
                </label>
                <label>
                  <span>结束日期</span>
                  <input type="date" />
                </label>
              </div>

              <div className="form-row">
                <label>
                  <span>每日投入</span>
                  <input placeholder="例如：60 分钟" />
                </label>
                <label>
                  <span>容错次数</span>
                  <input placeholder="例如：3 天" />
                </label>
              </div>

              <label>
                <span>完成后的奖励</span>
                <input placeholder="例如：买一把喜欢的键盘，或安排一次短途旅行" />
              </label>

              <button className="primary-button" type="button">
                生成 AI 目标计划
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </form>
          </div>

          <aside className="status-column" aria-label="MVP 状态预览">
            {session ? (
              <section className="auth-panel signed-in" aria-label="当前账号">
                <p className="section-label">当前账号</p>
                <h2>{session.user.displayName ?? session.user.email}</h2>
                <p className="auth-message">
                  {session.user.membership?.plan ?? "FREE"} 计划已就绪，可以继续创建目标。
                </p>
              </section>
            ) : (
              <AuthPanel onAuthenticated={setSession} />
            )}

            <div className="summary-strip">
              {setupFields.map((field) => (
                <span key={field}>{field}</span>
              ))}
            </div>

            <div className="vision-board">
              <div>
                <p className="section-label">奖励愿景板</p>
                <h2>阶段奖励 + 最终奖励</h2>
              </div>
              <div className="reward-list">
                <div>
                  <Trophy size={18} aria-hidden="true" />
                  第 30 天：一次认真休息
                </div>
                <div>
                  <Flame size={18} aria-hidden="true" />
                  最终达成：兑现愿望卡片
                </div>
              </div>
            </div>

            <div className="heatmap-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-label">成长热力图</p>
                  <h2>执行强度预览</h2>
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
            </div>
          </aside>
        </div>
      </section>

      <section className="journey-grid" aria-label="目标陪跑流程">
        {journeySteps.map((step) => {
          const Icon = step.icon;
          return (
            <article className="journey-item" key={step.title}>
              <Icon size={22} aria-hidden="true" />
              <h2>{step.title}</h2>
              <p>{step.text}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}

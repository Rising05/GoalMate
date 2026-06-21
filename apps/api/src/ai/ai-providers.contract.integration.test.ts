import "reflect-metadata";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { DailyTask } from "@prisma/client";
import { DeepSeekScoringProvider } from "../daily-tasks/deepseek-scoring.provider";
import { GoalsService } from "../goals/goals.service";
import { AiCallService } from "./ai-call.service";
import { AI_JSON_SCHEMAS } from "./ai-schemas";

const originalProvider = process.env.AI_PROVIDER;

describe("AI provider contracts", () => {
  after(() => {
    if (originalProvider == null) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
  });

  it("computes scoring totals from the fixed six-dimension rubric", async () => {
    const response = {
      dimensions: {
        completion: { score: 90, evidence: ["完成了任务"] },
        timeMatch: { score: 80, evidence: ["投入30分钟"] },
        evidence: { score: 70, evidence: ["提交截图"] },
        questionAccuracy: { score: 60, evidence: ["正确率60%"] },
        reflection: { score: 50, evidence: ["写了复盘"] },
        studyQuality: { score: 40, evidence: ["完成核心内容"] }
      },
      summary: "评分完成。",
      suggestion: "继续补强证据。"
    };
    const ai = { isConfigured: () => true, completeJson: async (call: { validate: (value: unknown) => unknown }) => call.validate(response) } as unknown as AiCallService;
    const provider = new DeepSeekScoringProvider(ai);
    const result = await provider.score({
      content: "完成任务并提交证据",
      investedMinutes: 30,
      evidence: { completedSubtasks: [], evidenceFiles: [], evidenceLinks: [] },
      task: { id: "task-1", title: "任务", description: "要求", goalId: "goal-1", taskType: "NORMAL", plannedMinutes: 30 } as DailyTask
    }, { userId: "user-1", goalId: "goal-1" });
    assert.equal(result.totalScore, 70);
    assert.deepEqual(Object.keys(result.dimensions), ["completion", "timeMatch", "evidence", "questionAccuracy", "reflection", "studyQuality"]);
    assert.equal((result.evidence.dimensions as Record<string, string[]>).completion[0], "完成了任务");
  });

  it("rejects scoring output that omits a rubric dimension", async () => {
    const ai = { isConfigured: () => true, completeJson: async (call: { validate: (value: unknown) => unknown }) => call.validate({ dimensions: {}, summary: "x", suggestion: "y" }) } as unknown as AiCallService;
    const provider = new DeepSeekScoringProvider(ai);
    await assert.rejects(provider.score({ content: "x", investedMinutes: 1, evidence: { completedSubtasks: [], evidenceFiles: [], evidenceLinks: [] }, task: { id: "task" } as DailyTask }, { userId: "user" }), /fixed six-dimension rubric/);
  });

  it("limits goal analysis to three material questions", async () => {
    process.env.AI_PROVIDER = "deepseek";
    const response = {
      structuredFields: { category: "STUDY", examName: "考试", targetScore: "80", currentScore: "60", targetDate: "2026-12-01", subjects: ["数学"], materials: ["教材"] },
      feasible: true,
      riskLevel: "warning",
      feasibilityScore: 75,
      reasons: [], assumptions: [], suggestedChanges: [],
      questions: ["问题1", "问题2", "问题3", "问题4"]
    };
    const ai = { isConfigured: () => true, completeJson: async (call: { validate: (value: unknown) => unknown }) => call.validate(response) } as unknown as AiCallService;
    const goals = new GoalsService({} as never, undefined, undefined, undefined, {} as never, ai);
    await assert.rejects(goals.analyzeGoal("user", { title: "考到80分" }), /0-3 items/);
  });

  it("publishes JSON schemas for every P0-3 capability", () => {
    assert.deepEqual(Object.keys(AI_JSON_SCHEMAS).sort(), ["appeal", "deviation", "failureReview", "goalAnalysis", "plan", "report", "rescue", "scoring"]);
  });
});

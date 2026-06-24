import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { GoalsService } from "./goals.service";

loadEnv();

const TEST_EMAIL_PREFIX = "goal-intake-integration-";
const prisma = new PrismaService();
const goalsService = new GoalsService(prisma);

describe("GoalsService intake draft integration", () => {
  before(cleanup);
  after(async () => { await cleanup(); await prisma.$disconnect(); });

  it("persists AI-assisted intake state without storing sensitive text in plaintext", async () => {
    const user = await createUser("persist");
    const naturalLanguage = "我想在 90 天内把考研英语从 62 分提高到 80 分，每天学习 90 分钟。";

    const created = await goalsService.createGoalIntakeDraft(user.id, {
      naturalLanguage,
      formDraft: {
        category: "postgrad_exam",
        endDate: "2026-09-30",
        dailyTimeBudgetMinutes: 90,
        targetScore: "80",
        currentScore: "62",
        subjects: ["英语阅读", "英语写作"]
      }
    });
    const latest = await goalsService.getLatestGoalIntakeDraft(user.id);
    const stored = await prisma.goalIntakeDraft.findUniqueOrThrow({
      where: { id: created.draft.id }
    });

    assert.equal(created.draft.naturalLanguage, naturalLanguage);
    assert.equal(created.draft.status, "ANALYZED");
    assert.ok(created.draft.analysis);
    assert.equal(created.draft.analysis.questions.length <= 3, true);
    assert.equal(created.draft.analysis.missingFields.includes("targetDate"), true);
    assert.equal(created.draft.formDraft?.category, "POSTGRAD_EXAM");
    assert.equal(created.draft.formDraft?.dailyTimeBudgetMinutes, 90);
    assert.deepEqual(created.draft.formDraft?.subjects, ["英语阅读", "英语写作"]);
    assert.equal(latest.draft?.id, created.draft.id);
    assert.notEqual(stored.naturalLanguage, naturalLanguage);
    assert.ok(stored.naturalLanguageKeyVersion);
    assert.ok(stored.analysisKeyVersion);
    assert.ok(stored.formDraftKeyVersion);
  });

  it("lets users update questions and field overrides before saving a goal draft", async () => {
    const user = await createUser("save");
    const created = await goalsService.createGoalIntakeDraft(user.id, {
      naturalLanguage: "三个月内完成 5 公里跑步训练，每周跑 4 天。",
      formDraft: {
        endDate: "2026-10-01",
        dailyTimeBudgetMinutes: 45
      }
    });
    const updated = await goalsService.updateGoalIntakeDraft(user.id, created.draft.id, {
      status: "USER_REVIEWING",
      acceptedFields: ["title", "endDate", "dailyTimeBudgetMinutes"],
      answers: [
        { question: "什么结果代表完成？", answer: "能连续跑完 5 公里" }
      ],
      formDraft: {
        title: "5 公里跑步训练",
        category: "fitness",
        description: "三个月内完成 5 公里跑步训练，每周跑 4 天。",
        startDate: "2026-07-01",
        endDate: "2026-10-01",
        dailyTimeBudgetMinutes: 45,
        toleranceDaysAllowed: 5,
        constraints: "膝盖不适时降低强度"
      }
    });
    const saved = await goalsService.createGoalFromIntakeDraft(user.id, created.draft.id, {
      overrides: {
        finalReward: "买一双新的跑鞋"
      }
    });
    const reloaded = await goalsService.getGoalIntakeDraft(user.id, created.draft.id);

    assert.equal(updated.draft.status, "USER_REVIEWING");
    assert.deepEqual(updated.draft.acceptedFields, ["title", "endDate", "dailyTimeBudgetMinutes"]);
    assert.equal(updated.draft.answers.length, 1);
    assert.equal(saved.goal.title, "5 公里跑步训练");
    assert.equal(saved.goal.category, "FITNESS");
    assert.equal(saved.goal.dailyTimeBudgetMinutes, 45);
    assert.equal(saved.goal.toleranceDaysAllowed, 5);
    assert.equal(saved.goal.finalReward, "买一双新的跑鞋");
    assert.equal(saved.draft.status, "GOAL_CREATED");
    assert.equal(saved.draft.completedGoalId, saved.goal.id);
    assert.equal(reloaded.draft.completedGoalId, saved.goal.id);
  });
});

async function cleanup() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    }
  });
}

async function createUser(scenario: string) {
  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${scenario}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: "test-password-hash"
    }
  });
}

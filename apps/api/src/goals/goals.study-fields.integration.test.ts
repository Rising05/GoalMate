import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AiJobsService } from "../ai-jobs/ai-jobs.service";
import { MockPlanProvider } from "../ai-jobs/mock-plan.provider";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { GoalsService } from "./goals.service";

loadEnv();

const TEST_EMAIL_PREFIX = "study-fields-integration-";

const prisma = new PrismaService();
const goalsService = new GoalsService(prisma);
const aiJobsService = new AiJobsService(prisma, new MockPlanProvider());

describe("GoalsService study fields integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("creates a study goal with exam metadata and generates detailed study tasks", async () => {
    const user = await createUser("postgrad");

    const created = await goalsService.createGoal(user.id, {
      title: "考研英语 80 分冲刺",
      description: "围绕考研英语进行 90 天备考，把阅读、写作和真题复盘拆成每日任务。",
      category: "postgrad_exam",
      startDate: "2026-06-12",
      endDate: "2026-06-25",
      dailyTimeBudgetMinutes: 90,
      dailyStudyMinutes: 90,
      studyDaysPerWeek: 6,
      toleranceDaysAllowed: 3,
      examName: "考研英语一",
      targetScore: "80",
      currentScore: "62",
      examDate: "2026-12-20",
      subjects: ["英语阅读", "英语写作"],
      materials: "真题阅读, 写作模板",
      chapters: ["阅读 Text 1", "小作文"],
      weaknesses: "长难句, 写作论证",
      mockExamFrequency: "每两周一次"
    });
    const planned = await aiJobsService.generateGoalPlan(user.id, created.goal.id);
    const storedGoal = await prisma.goal.findUniqueOrThrow({
      where: { id: created.goal.id }
    });
    const storedTask = await prisma.dailyTask.findFirstOrThrow({
      where: {
        goalId: created.goal.id,
        studyTaskType: {
          not: null
        }
      },
      orderBy: { taskDate: "asc" }
    });
    const firstPlanTask = planned.plan?.weeklyPlans[0]?.dailyTasks[0];

    assert.equal(created.goal.category, "POSTGRAD_EXAM");
    assert.equal(created.goal.examName, "考研英语一");
    assert.equal(created.goal.targetScore, "80");
    assert.equal(created.goal.currentScore, "62");
    assert.equal(created.goal.studyDaysPerWeek, 6);
    assert.deepEqual(created.goal.subjects, ["英语阅读", "英语写作"]);
    assert.deepEqual(created.goal.materials, ["真题阅读", "写作模板"]);
    assert.deepEqual(created.goal.chapters, ["阅读 Text 1", "小作文"]);
    assert.deepEqual(created.goal.weaknesses, ["长难句", "写作论证"]);
    assert.equal(storedGoal.category, "POSTGRAD_EXAM");
    assert.equal(storedGoal.dailyStudyMinutes, 90);
    assert.equal(planned.job.status, "SUCCEEDED");
    assert.ok(firstPlanTask);
    assert.ok(firstPlanTask.studyTaskType);
    assert.ok(firstPlanTask.subject);
    assert.ok(firstPlanTask.chapterRef);
    assert.equal(firstPlanTask.evidenceRequired, true);
    assert.ok((firstPlanTask.questionCount ?? 0) > 0);
    assert.equal(storedTask.studyTaskType, firstPlanTask.studyTaskType);
    assert.equal(storedTask.subject, firstPlanTask.subject);
    assert.equal(storedTask.evidenceRequired, firstPlanTask.evidenceRequired);
  });
});

async function cleanupTestUsers() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    }
  });
}

async function createUser(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Study fields ${scenario}`
    }
  });
}

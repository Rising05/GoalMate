import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { DailyTasksService } from "../daily-tasks/daily-tasks.service";
import { GoalsService } from "../goals/goals.service";
import { PrismaService } from "../prisma/prisma.service";
import { GrowthEventsService } from "./growth-events.service";

loadEnv();

const TEST_EMAIL_PREFIX = "growth-events-integration-";
const prisma = new PrismaService();
const growthEventsService = new GrowthEventsService(prisma);
const goalsService = new GoalsService(prisma);
const dailyTasksService = new DailyTasksService(prisma);

describe("GrowthEventsService integration", () => {
  before(cleanup);
  after(async () => { await cleanup(); await prisma.$disconnect(); });

  it("records goal and task lifecycle events and supports filtered pagination", async () => {
    const user = await createUser("owner");
    const otherUser = await createUser("other");
    const created = await goalsService.createGoal(user.id, {
      title: "统一成长事件目标",
      description: "验证目标创建和任务完成会进入统一成长事件表。",
      category: "custom",
      startDate: "2026-06-24",
      endDate: "2026-07-24",
      dailyTimeBudgetMinutes: 30,
      toleranceDaysAllowed: 3
    });
    const otherGoal = await goalsService.createGoal(otherUser.id, {
      title: "其他用户目标",
      description: "不应出现在当前用户的事件列表中。",
      category: "custom",
      startDate: "2026-06-24",
      endDate: "2026-07-24",
      dailyTimeBudgetMinutes: 30,
      toleranceDaysAllowed: 3
    });

    await prisma.goal.update({
      where: { id: created.goal.id },
      data: { status: "ACTIVE" }
    });
    const task = await prisma.dailyTask.create({
      data: {
        goalId: created.goal.id,
        taskDate: new Date("2026-06-24T00:00:00.000+08:00"),
        title: "完成统一事件测试任务",
        description: "提交一次打卡，验证统一事件写入。",
        plannedMinutes: 30,
        status: "PENDING"
      }
    });

    const completed = await dailyTasksService.completeTask(user.id, task.id, {
      content: "已完成任务并提交复盘。",
      investedMinutes: 35,
      completedSubtasks: ["完成复盘"]
    });
    const all = await growthEventsService.list(user.id, {
      goalId: created.goal.id,
      page: "1",
      pageSize: "10"
    });
    const taskEvents = await growthEventsService.list(user.id, {
      goalId: created.goal.id,
      type: "TASK_COMPLETED,CHECKIN_SCORED",
      page: "1",
      pageSize: "10"
    });
    const otherUserEvents = await growthEventsService.list(user.id, {
      goalId: otherGoal.goal.id,
      page: "1",
      pageSize: "10"
    });

    assert.equal(completed.task.status, "DONE");
    assert.equal(
      all.events.some((event) => event.type === "GOAL_CREATED"),
      true
    );
    assert.equal(
      all.events.some((event) => event.goalTitle === "统一成长事件目标"),
      true
    );
    assert.equal(
      taskEvents.events.some(
        (event) =>
          event.type === "TASK_COMPLETED" &&
          event.sourceResourceType === "DAILY_TASK" &&
          event.sourceResourceId === task.id
      ),
      true
    );
    assert.equal(
      taskEvents.events.some(
        (event) =>
          event.type === "CHECKIN_SCORED" &&
          event.sourceResourceType === "CHECKIN"
      ),
      true
    );
    assert.equal(taskEvents.total, 2);
    assert.equal(taskEvents.page, 1);
    assert.equal(taskEvents.pageSize, 10);
    assert.equal(otherUserEvents.total, 0);
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

import { expect, test } from "@playwright/test";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client";

const apiPort = process.env.E2E_API_PORT ?? "3100";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const prisma = new PrismaClient();

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

async function getSessionToken(page: import("@playwright/test").Page) {
  const token = await page.evaluate(() => localStorage.getItem("goalmate.session"));

  expect(token).toBeTruthy();

  return token!;
}

async function registerViaApi(
  request: import("@playwright/test").APIRequestContext,
  input: { email: string; password: string; displayName: string }
) {
  const response = await request.post(`${apiUrl}/auth/register`, {
    data: input
  });

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as { user: { id: string; email: string } };
}

async function loginViaApi(
  request: import("@playwright/test").APIRequestContext,
  input: { email: string; password: string }
) {
  const response = await request.post(`${apiUrl}/auth/login`, {
    data: input
  });

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as { token: string };
}

async function loadWebSession(
  page: import("@playwright/test").Page,
  token: string
) {
  await page.goto("/");
  await page.evaluate((sessionToken) => {
    localStorage.setItem("goalmate.session", sessionToken);
  }, token);
  const currentUserResponse = page.waitForResponse(
    (response) => response.url().includes("/auth/me") && response.request().method() === "GET"
  );
  await page.reload();
  await expect((await currentUserResponse).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1, name: "创建目标" })).toBeVisible();
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("admin navigation is only visible to active admin accounts", async ({
  page,
  request
}) => {
  const stamp = Date.now();
  const password = "Password123!";
  const regularEmail = `e2e-regular-${stamp}@example.com`;
  const adminEmail = `e2e-admin-${stamp}@example.com`;

  const regular = await registerViaApi(request, {
    email: regularEmail,
    password,
    displayName: "Regular User"
  });
  const admin = await registerViaApi(request, {
    email: adminEmail,
    password,
    displayName: "Admin User"
  });

  await prisma.adminUser.create({
    data: {
      userId: admin.user.id,
      role: "OPERATOR",
      status: "ACTIVE"
    }
  });

  const regularSession = await loginViaApi(request, {
    email: regular.user.email,
    password
  });
  await loadWebSession(page, regularSession.token);
  await expect(page.getByRole("button", { name: /后台管理/ })).toHaveCount(0);

  const adminSession = await loginViaApi(request, {
    email: admin.user.email,
    password
  });
  await loadWebSession(page, adminSession.token);
  await expect(page.getByRole("button", { name: /后台管理/ })).toBeVisible();
});

test("queued AI jobs can be cancelled by the owning user", async ({ request }) => {
  const stamp = Date.now();
  const password = "Password123!";
  const email = `e2e-cancel-ai-${stamp}@example.com`;
  const registered = await registerViaApi(request, {
    email,
    password,
    displayName: "Cancel AI User"
  });
  const session = await loginViaApi(request, {
    email,
    password
  });
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(now.getDate() + 7);
  const goal = await prisma.goal.create({
    data: {
      userId: registered.user.id,
      title: `E2E Cancel AI ${stamp}`,
      description: "用于验证排队 AI 任务取消后目标状态恢复。",
      status: "GENERATING_PLAN",
      startDate: now,
      endDate,
      toleranceDaysAllowed: 1,
      dailyTimeBudgetMinutes: 30
    }
  });
  const job = await prisma.aiJob.create({
    data: {
      userId: registered.user.id,
      goalId: goal.id,
      type: "GOAL_PLAN_GENERATION",
      status: "QUEUED",
      attempts: 0,
      payload: {
        goalId: goal.id,
        provider: "e2e"
      }
    }
  });

  const cancelResponse = await request.post(`${apiUrl}/ai-jobs/${job.id}/cancel`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    },
    data: {
      reason: "E2E 用户取消排队任务"
    }
  });

  expect(cancelResponse.ok()).toBeTruthy();
  const cancelBody = (await cancelResponse.json()) as {
    cancelled: boolean;
    job: { status: string; error: string | null };
  };
  const [cancelledJob, restoredGoal] = await Promise.all([
    prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } }),
    prisma.goal.findUniqueOrThrow({ where: { id: goal.id } })
  ]);

  expect(cancelBody.cancelled).toBeTruthy();
  expect(cancelBody.job.status).toBe("CANCELLED");
  expect(cancelledJob.status).toBe("CANCELLED");
  expect(cancelledJob.error).toBe("E2E 用户取消排队任务");
  expect(restoredGoal.status).toBe("DRAFT");
});

test("new user completes the core GoalPilot MVP loop", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e-core-${stamp}@example.com`;
  const password = "Password123!";
  const goalTitle = `E2E GoalPilot MVP ${stamp}`;
  const completedGoalTitle = `E2E Goal Completed ${stamp}`;
  const failedGoalTitle = `E2E Failure Review ${stamp}`;
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 14);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  await page.goto("/");
  await page.getByRole("button", { name: /账号/ }).click();

  await page.getByLabel("昵称").fill("E2E User");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "创建账号" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "创建目标" })).toBeVisible();
  await getSessionToken(page);

  await page.getByLabel("目标标题").fill(goalTitle);
  await page
    .getByLabel("目标描述")
    .fill("通过 E2E 测试验证 GoalPilot AI MVP 的完整用户闭环。");
  await page.getByLabel("每日投入分钟").fill("30");
  await page.getByLabel("开始日期").fill(toDateInputValue(today));
  await page.getByLabel("结束日期").fill(toDateInputValue(endDate));
  await page.getByLabel("容错次数").fill("3");
  await page.getByLabel("当前基础").fill("已具备基础使用能力");
  await page.getByLabel("主要限制").fill("每天只能投入半小时");
  await page.getByLabel("完成奖励").fill("完成后喝一杯喜欢的咖啡");
  await page.getByRole("button", { name: /保存草稿/ }).click();

  await expect(page.getByRole("button", { name: new RegExp(goalTitle) })).toBeVisible();
  await expect(page.getByRole("button", { name: /^生成 AI 计划/ })).toBeVisible();

  await page.getByRole("button", { name: /^生成 AI 计划/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "AI 计划确认" })).toBeVisible();
  await expect(page.getByRole("heading", { name: goalTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: /确认计划并开始执行/ })).toBeEnabled();

  await page.getByRole("button", { name: /确认计划并开始执行/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "今日任务" })).toBeVisible();

  await page.locator(".task-row").first().getByRole("button", { name: "完成" }).click();
  await expect(page.getByRole("heading", { name: "完成任务复盘" })).toBeVisible();
  await page.getByLabel("实际投入分钟").fill("30");
  await page
    .getByLabel("今天完成了什么")
    .fill("完成了今天计划任务，整理了关键笔记，并记录了下一步行动。");
  await page.getByLabel("遇到的问题").fill("时间较短，需要保持任务粒度足够小。");
  await page.getByLabel("明日调整").fill("明天先复习今日笔记，再进入下一项任务。");
  await page.getByRole("button", { name: /提交复盘/ }).click();

  await expect(page.getByText("热力图已记录今日完成")).toBeVisible();
  await expect(page.getByText(/评分任务 已完成/)).toBeVisible();
  await page.getByRole("button", { name: /返回今日任务/ }).click();

  await expect(page.getByText(/今日快照 .* 已保存/)).toBeVisible();
  const reportArtifactResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/report-artifacts") &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "生成周报" }).click();
  await expect((await reportArtifactResponse).ok()).toBeTruthy();
  await expect(page.getByText(new RegExp(`${goalTitle} 周报`)).first()).toBeVisible();
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /下载报告/ }).first().click();
  expect((await reportDownload).suggestedFilename()).toMatch(/weekly_trend-.*\.md/);

  const rescueResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/rescue-task") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /生成救援任务/ }).last().click();
  await expect((await rescueResponse).ok()).toBeTruthy();
  await expect(page.getByRole("button", { name: "完成救援任务" })).toBeVisible();
  await page.getByRole("button", { name: "完成救援任务" }).click();

  await expect(page.getByRole("heading", { name: "完成任务复盘" })).toBeVisible();
  await page.getByLabel("实际投入分钟").fill("15");
  await page
    .getByLabel("今天完成了什么")
    .fill("完成救援任务，补齐了今天最小行动，并恢复到可继续推进的节奏。");
  await page.getByRole("button", { name: /提交复盘/ }).click();
  await expect(page.getByText("热力图已记录今日完成")).toBeVisible();
  await page.getByRole("button", { name: /查看热力图/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "成长热力图" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /2 次成长记录/ })).toBeVisible();

  await page.getByRole("button", { name: /成长时间线/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "成长时间线" })).toBeVisible();
  await expect(page.getByText("触发偏差")).toBeVisible();
  await expect(page.getByText("救援任务完成")).toBeVisible();
  await expect(page.getByText(/AI \d+/).first()).toBeVisible();

  const token = await getSessionToken(page);
  const goalsResponse = await request.get(`${apiUrl}/goals`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  expect(goalsResponse.ok()).toBeTruthy();
  const goalsBody = (await goalsResponse.json()) as {
    goals: Array<{ id: string; title: string; status: string }>;
  };
  const goal = goalsBody.goals.find((item) => item.title === goalTitle);

  expect(goal).toBeTruthy();
  expect(["ACTIVE", "AT_RISK", "REPLANNING"]).toContain(goal!.status);

  const healthResponse = await request.get(`${apiUrl}/goals/${goal!.id}/health`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  expect(healthResponse.ok()).toBeTruthy();
  const health = (await healthResponse.json()) as {
    healthScore: number;
    snapshot: { date: string };
    rescueSuccessCount7d: number;
  };

  expect(health.healthScore).toBeGreaterThan(0);
  expect(health.snapshot.date).toBe(toDateInputValue(today));
  expect(health.rescueSuccessCount7d).toBeGreaterThanOrEqual(1);

  const timelineResponse = await request.get(
    `${apiUrl}/daily-tasks/timeline?goalId=${goal!.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  expect(timelineResponse.ok()).toBeTruthy();
  const timeline = (await timelineResponse.json()) as {
    days: Array<{ items: Array<{ kind: string; deviationEventId?: string | null }> }>;
  };
  const timelineItems = timeline.days.flatMap((day) => day.items);

  expect(timelineItems.some((item) => item.kind === "DEVIATION")).toBeTruthy();
  expect(timelineItems.some((item) => item.deviationEventId)).toBeTruthy();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /目标列表/ }).click();
  await page.getByRole("button", { name: /删除目标/ }).click();
  await expect(page.getByText("目标及关联数据已删除。")).toBeVisible();

  await page.getByRole("button", { name: /创建目标/ }).click();
  await page.getByLabel("目标标题").fill(completedGoalTitle);
  await page
    .getByLabel("目标描述")
    .fill("通过 E2E 测试验证目标到达结束日期后可完成结算。");
  await page.getByLabel("每日投入分钟").fill("20");
  await page.getByLabel("开始日期").fill(toDateInputValue(yesterday));
  await page.getByLabel("结束日期", { exact: true }).fill(toDateInputValue(yesterday));
  await page.getByLabel("容错次数").fill("2");
  await page.getByLabel("当前基础").fill("已经完成主要任务");
  await page.getByLabel("主要限制").fill("仅需完成最后结算");
  await page.getByLabel("完成奖励").fill("完成后归档阶段成果");
  await page.getByRole("button", { name: /保存草稿/ }).click();

  await expect(page.getByRole("button", { name: new RegExp(completedGoalTitle) })).toBeVisible();
  await expect(page.getByRole("button", { name: /^生成 AI 计划/ })).toBeVisible();

  await page.getByRole("button", { name: /^生成 AI 计划/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "AI 计划确认" })).toBeVisible();
  await expect(page.getByRole("heading", { name: completedGoalTitle })).toBeVisible();
  await page.getByRole("button", { name: /确认计划并开始执行/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "今日任务" })).toBeVisible();

  await page.getByRole("button", { name: /目标列表/ }).click();
  await page.getByRole("button", { name: new RegExp(completedGoalTitle) }).click();
  const completionSettlementResponse = page.waitForResponse(
    (response) => response.url().includes("/settle") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /结算状态/ }).click();
  await expect((await completionSettlementResponse).ok()).toBeTruthy();

  const completedGoalsResponse = await request.get(`${apiUrl}/goals`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  expect(completedGoalsResponse.ok()).toBeTruthy();
  const completedGoalsBody = (await completedGoalsResponse.json()) as {
    goals: Array<{ id: string; title: string; status: string }>;
  };
  const completedGoal = completedGoalsBody.goals.find(
    (item) => item.title === completedGoalTitle
  );

  expect(completedGoal).toBeTruthy();
  expect(completedGoal!.status).toBe("COMPLETED");

  await page.getByRole("button", { name: /创建目标/ }).click();
  await page.getByLabel("目标标题").fill(failedGoalTitle);
  await page
    .getByLabel("目标描述")
    .fill("通过 E2E 测试验证目标失败结算、失败复盘和重新开启目标。");
  await page.getByLabel("每日投入分钟").fill("20");
  await page.getByLabel("开始日期").fill(toDateInputValue(yesterday));
  await page.getByLabel("结束日期").fill(toDateInputValue(yesterday));
  await page.getByLabel("容错次数").fill("0");
  await page.getByLabel("当前基础").fill("上一轮执行已经中断");
  await page.getByLabel("主要限制").fill("计划已过期且任务未完成");
  await page.getByLabel("完成奖励").fill("重开后恢复稳定节奏");
  await page.getByRole("button", { name: /保存草稿/ }).click();

  await expect(page.getByRole("button", { name: new RegExp(failedGoalTitle) })).toBeVisible();
  await expect(page.getByRole("button", { name: /^生成 AI 计划/ })).toBeVisible();

  await page.getByRole("button", { name: /^生成 AI 计划/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "AI 计划确认" })).toBeVisible();
  await expect(page.getByRole("heading", { name: failedGoalTitle })).toBeVisible();
  await page.getByRole("button", { name: /确认计划并开始执行/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "今日任务" })).toBeVisible();

  await page.getByRole("button", { name: /目标列表/ }).click();
  await page.getByRole("button", { name: new RegExp(failedGoalTitle) }).click();
  await page.getByRole("button", { name: /结算状态/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: "失败复盘" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "失败原因分析" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "断签时间线" })).toBeVisible();
  await expect(page.getByText("AI 复盘建议")).toBeVisible();

  const failedGoalsResponse = await request.get(`${apiUrl}/goals`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  expect(failedGoalsResponse.ok()).toBeTruthy();
  const failedGoalsBody = (await failedGoalsResponse.json()) as {
    goals: Array<{ id: string; title: string; status: string }>;
  };
  const failedGoal = failedGoalsBody.goals.find((item) => item.title === failedGoalTitle);

  expect(failedGoal).toBeTruthy();
  expect(failedGoal!.status).toBe("FAILED");

  const failureReportResponse = await request.get(
    `${apiUrl}/goals/${failedGoal!.id}/failure-report`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  expect(failureReportResponse.ok()).toBeTruthy();
  const failureReport = (await failureReportResponse.json()) as {
    brokenStreakTimeline: Array<{ date: string }>;
    suggestion: string;
  };

  expect(failureReport.brokenStreakTimeline.length).toBeGreaterThanOrEqual(1);
  expect(failureReport.suggestion).toContain("重新开启");

  await page.getByRole("button", { name: /创建新目标/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "AI 计划确认" })).toBeVisible();

  const restartedGoalsResponse = await request.get(`${apiUrl}/goals`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  expect(restartedGoalsResponse.ok()).toBeTruthy();
  const restartedGoalsBody = (await restartedGoalsResponse.json()) as {
    goals: Array<{ title: string; status: string }>;
  };

  expect(
    restartedGoalsBody.goals.some(
      (item) => item.title === `${failedGoalTitle}（重新开始）` && item.status === "DRAFT"
    )
  ).toBeTruthy();
});

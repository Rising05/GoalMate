import { expect, test } from "@playwright/test";
import { PrismaClient } from "../../apps/api/node_modules/@prisma/client";
import { createHmac } from "node:crypto";

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
  if (page.url() === "about:blank") {
    await page.goto("/");
  }
  await page.evaluate((sessionToken) => {
    localStorage.setItem("goalmate.session", sessionToken);
  }, token);
  const [authResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/auth/me") && response.ok()),
    page.reload()
  ]);
  await expect(page.getByRole("heading", { level: 1, name: "创建目标" })).toBeVisible();
  return (await authResponse.json()) as { user: { email: string; adminRole: string | null } };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("health and metrics expose correlation and operational signals", async ({ request }) => {
  const requestId = `e2e-request-${Date.now()}`;
  const health = await request.get(`${apiUrl}/health`, { headers: { "x-request-id": requestId } });
  expect(health.ok()).toBeTruthy();
  expect(health.headers()["x-request-id"]).toBe(requestId);
  expect(health.headers()["x-trace-id"]).toBe(requestId);
  const readiness = await request.get(`${apiUrl}/health/readiness`);
  expect(readiness.ok()).toBeTruthy();
  expect((await readiness.json()).mysqlUp).toBe(true);
  const metrics = await request.get(`${apiUrl}/metrics`);
  expect(metrics.ok()).toBeTruthy();
  const text = await metrics.text();
  expect(text).toContain("goalmate_http_requests_total");
  expect(text).toContain("goalmate_ai_jobs_total");
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
  const forbiddenAdminResponse = await request.get(`${apiUrl}/admin/upload-assets`, {
    headers: { Authorization: `Bearer ${regularSession.token}` }
  });
  expect(forbiddenAdminResponse.status()).toBe(403);

  const adminSession = await loginViaApi(request, {
    email: admin.user.email,
    password
  });
  const loadedAdmin = await loadWebSession(page, adminSession.token);
  expect(loadedAdmin.user.adminRole).toBe("OPERATOR");
  await expect(page.getByRole("button", { name: /后台管理/ })).toBeVisible();
  for (const path of ["upload-assets", "payment-events", "membership-audits", "ai-call-logs"]) {
    const response = await request.get(`${apiUrl}/admin/${path}`, {
      headers: { Authorization: `Bearer ${adminSession.token}` }
    });
    expect(response.ok()).toBeTruthy();
  }
});

test("goal analysis remains available without a real AI key", async ({ request }) => {
  const stamp = Date.now();
  const password = "Password123!";
  const registered = await registerViaApi(request, {
    email: `e2e-goal-analysis-${stamp}@example.com`,
    password,
    displayName: "Goal Analysis User"
  });
  const session = await loginViaApi(request, { email: registered.user.email, password });
  const response = await request.post(`${apiUrl}/goals/analyze`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { title: "六个月后英语考试达到 80 分" }
  });
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.provider).toBe("rule");
  expect(result.questions.length).toBeLessThanOrEqual(3);
  expect(result.structuredFields.title).toContain("英语考试");
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

test("payment webhook replay activates Pro only once", async ({ request }) => {
  const stamp = Date.now();
  const registered = await registerViaApi(request, {
    email: `e2e-payment-${stamp}@example.com`,
    password: "Password123!",
    displayName: "Payment User"
  });
  const session = await loginViaApi(request, {
    email: registered.user.email,
    password: "Password123!"
  });
  const orderResponse = await request.post(`${apiUrl}/billing/orders`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { provider: "MOCK", durationDays: 30 }
  });
  expect(orderResponse.ok()).toBeTruthy();
  const order = (await orderResponse.json()) as { order: { id: string } };
  const payload = {
    eventId: `e2e-event-${stamp}`,
    orderId: order.order.id,
    status: "PAID"
  };
  const signature = createHmac("sha256", "goalmate-mock-payment")
    .update(JSON.stringify(payload))
    .digest("hex");
  const first = await request.post(`${apiUrl}/billing/webhooks/mock`, {
    headers: { "x-payment-signature": signature },
    data: payload
  });
  const firstMembership = await prisma.membership.findUniqueOrThrow({
    where: { userId: registered.user.id }
  });
  const replay = await request.post(`${apiUrl}/billing/webhooks/mock`, {
    headers: { "x-payment-signature": signature },
    data: payload
  });
  const finalMembership = await prisma.membership.findUniqueOrThrow({
    where: { userId: registered.user.id }
  });

  expect(first.ok()).toBeTruthy();
  expect(replay.ok()).toBeTruthy();
  expect((await replay.json()).duplicate).toBeTruthy();
  expect(finalMembership.plan).toBe("PRO");
  expect(finalMembership.expiresAt?.toISOString()).toBe(
    firstMembership.expiresAt?.toISOString()
  );
  expect(await prisma.paymentEvent.count({ where: { orderId: order.order.id } })).toBe(1);
});

test("notification compensation scheduling is timezone-aware and idempotent", async ({ request }) => {
  const stamp = Date.now();
  const password = "Password123!";
  const user = await registerViaApi(request, {
    email: `e2e-scheduler-user-${stamp}@example.com`,
    password,
    displayName: "Scheduler User"
  });
  const admin = await registerViaApi(request, {
    email: `e2e-scheduler-admin-${stamp}@example.com`,
    password,
    displayName: "Scheduler Admin"
  });
  await prisma.adminUser.create({
    data: { userId: admin.user.id, role: "OPERATOR", status: "ACTIVE" }
  });
  const userSession = await loginViaApi(request, { email: user.user.email, password });
  const adminSession = await loginViaApi(request, { email: admin.user.email, password });
  const goal = await prisma.goal.create({
    data: {
      userId: user.user.id,
      title: `E2E scheduler ${stamp}`,
      description: "Timezone-aware notification scheduling",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date("2026-06-01T04:00:00.000Z"),
      endDate: new Date("2026-06-30T04:00:00.000Z"),
      toleranceDaysAllowed: 2,
      dailyTasks: {
        create: {
          taskDate: new Date("2026-06-10T04:00:00.000Z"),
          title: "New York due task",
          description: "Notification E2E task",
          status: "PENDING"
        }
      }
    }
  });
  const preference = await request.put(`${apiUrl}/notifications/preferences`, {
    headers: { Authorization: `Bearer ${userSession.token}` },
    data: {
      enabled: true,
      reminderTime: "09:00",
      reminderTypes: ["DAILY_TASK"],
      channels: ["EMAIL"],
      timezone: "America/New_York",
      silentDays: [],
      examSprintDays: 7
    }
  });
  expect(preference.ok()).toBeTruthy();

  for (const reason of ["首次补偿提醒扫描", "重复补偿提醒扫描"]) {
    const response = await request.post(`${apiUrl}/admin/notifications/scheduler/run`, {
      headers: { Authorization: `Bearer ${adminSession.token}` },
      data: { now: "2026-06-10T13:30:00.000Z", reason }
    });
    expect(response.ok()).toBeTruthy();
  }

  const logs = await prisma.emailLog.findMany({
    where: { userId: user.user.id, goalId: goal.id, type: "DAILY_TASK" }
  });
  expect(logs).toHaveLength(1);
  expect(logs[0].source).toBe("ADMIN_COMPENSATION");
  expect(logs[0].dedupeKey).toContain("2026-06-10");
  expect(logs[0].schedulerRunId).toBeTruthy();
});

test("free scoring quota is enforced through the HTTP API", async ({ request }) => {
  const stamp = Date.now();
  const password = "Password123!";
  const registered = await registerViaApi(request, {
    email: `e2e-quota-${stamp}@example.com`,
    password,
    displayName: "Quota User"
  });
  const session = await loginViaApi(request, {
    email: registered.user.email,
    password
  });
  const goal = await prisma.goal.create({
    data: {
      userId: registered.user.id,
      title: `E2E quota ${stamp}`,
      description: "HTTP quota enforcement",
      category: "STUDY",
      status: "ACTIVE",
      startDate: new Date(),
      endDate: new Date(Date.now() + 7 * 86_400_000),
      toleranceDaysAllowed: 2
    }
  });
  const tasks = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      prisma.dailyTask.create({
        data: {
          goalId: goal.id,
          taskDate: new Date(),
          title: `Quota task ${index + 1}`,
          description: "Complete through API",
          plannedMinutes: 10,
          status: "PENDING"
        }
      })
    )
  );

  for (const task of tasks.slice(0, 3)) {
    const response = await request.post(`${apiUrl}/daily-tasks/${task.id}/complete`, {
      headers: { Authorization: `Bearer ${session.token}` },
      data: { content: `完成内容：${task.title}`, investedMinutes: 10 }
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    expect(result.checkin.aiScore.totalScore).toBeNull();
  }

  const blocked = await request.post(`${apiUrl}/daily-tasks/${tasks[3].id}/complete`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { content: "完成内容：第四次请求", investedMinutes: 10 }
  });
  expect(blocked.status()).toBe(429);
  expect((await blocked.json()).error).toBe("QUOTA_EXCEEDED");
  const current = await request.get(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${session.token}` }
  });
  const currentBody = await current.json();
  expect(currentBody.user.quota.aiJobsToday.used).toBe(3);
  expect(currentBody.user.quota.aiJobsToday.limit).toBe(3);
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
  const initialToken = await getSessionToken(page);
  const coreUser = await prisma.user.findUniqueOrThrow({ where: { email } });
  await prisma.membership.update({
    where: { userId: coreUser.id },
    data: {
      plan: "PRO",
      status: "ACTIVE",
      expiresAt: new Date(Date.now() + 30 * 86_400_000)
    }
  });

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
  await page.getByLabel("上传图片、截图或 PDF").setInputFiles({
    name: "e2e-proof.png",
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.from("goalmate-e2e-proof")
    ])
  });
  await page.getByLabel("遇到的问题").fill("时间较短，需要保持任务粒度足够小。");
  await page.getByLabel("明日调整").fill("明天先复习今日笔记，再进入下一项任务。");
  await page.getByRole("button", { name: /提交复盘/ }).click();

  await expect(page.getByText("热力图已记录今日完成")).toBeVisible();
  await expect(page.getByText("图片/文件 1 条")).toBeVisible();
  await expect(page.getByText("AI 总结")).toBeVisible();
  await expect(page.getByText("明日建议")).toBeVisible();
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

  const previewReminder = await request.post(`${apiUrl}/notifications/email-logs/preview`, {
    headers: { Authorization: `Bearer ${initialToken}` },
    data: { type: "DAILY_TASK", scheduledFor: new Date(Date.now() - 1000).toISOString() }
  });
  expect(previewReminder.ok()).toBeTruthy();
  const processReminders = await request.post(`${apiUrl}/notifications/email-logs/process-queue`, {
    headers: { Authorization: `Bearer ${initialToken}` },
    data: {}
  });
  expect(processReminders.ok()).toBeTruthy();
  expect((await processReminders.json()).sent).toBeGreaterThanOrEqual(1);

  const exportResponse = await request.post(`${apiUrl}/auth/export`, {
    headers: { Authorization: `Bearer ${initialToken}` },
    data: { format: "JSON", fullExport: true }
  });
  expect(exportResponse.ok()).toBeTruthy();
  const exported = (await exportResponse.json()) as {
    data: { reportArtifacts: unknown[]; uploadAssets: unknown[]; emailLogs: unknown[] };
  };
  expect(exported.data.reportArtifacts.length).toBeGreaterThanOrEqual(1);
  expect(exported.data.uploadAssets.length).toBeGreaterThanOrEqual(1);
  expect(exported.data.emailLogs.length).toBeGreaterThanOrEqual(1);

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

import { expect, test } from "@playwright/test";

const apiPort = process.env.E2E_API_PORT ?? "3100";
const apiUrl = `http://127.0.0.1:${apiPort}`;

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

test("new user completes the core GoalPilot MVP loop", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e-core-${stamp}@example.com`;
  const password = "Password123!";
  const goalTitle = `E2E GoalPilot MVP ${stamp}`;
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 14);

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

  await expect(page.getByText(`目标草稿已保存：${goalTitle}`)).toBeVisible();

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
  await page.getByRole("button", { name: /生成救援任务/ }).last().click();
  await expect(page.getByText("救援任务已保存到今日任务，可以直接完成。")).toBeVisible();
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
});

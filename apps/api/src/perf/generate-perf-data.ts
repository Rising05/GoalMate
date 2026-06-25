/**
 * Performance Test Data Generator
 *
 * Generates realistic test data for load testing GoalMate.
 * Run: npx tsx apps/api/src/perf/generate-perf-data.ts
 *
 * Features:
 *   - Parameterized user, goal, task, and checkin counts
 *   - All data prefixed for easy cleanup
 *   - Repeatable: detects existing data and skips
 *   - Idempotent generation
 *
 * Environment: requires DATABASE_URL for Prisma connection.
 */

import { PrismaClient } from "@prisma/client";
import { randomBytes, randomInt } from "crypto";

const prisma = new PrismaClient();

// ---- Configuration (override via env) ----
const CONFIG = {
  PREFIX: process.env.PERF_PREFIX || "perf_",
  USER_COUNT: parseInt(process.env.PERF_USERS || "100", 10),
  GOALS_PER_USER: parseInt(process.env.PERF_GOALS_PER_USER || "3", 10),
  TASK_DAYS: parseInt(process.env.PERF_TASK_DAYS || "30", 10),
  TASKS_PER_DAY: parseInt(process.env.PERF_TASKS_PER_DAY || "3", 10),
  CHECKIN_RATE: parseFloat(process.env.PERF_CHECKIN_RATE || "0.8"),
  AI_JOBS_PER_GOAL: parseInt(process.env.PERF_AI_JOBS_PER_GOAL || "5", 10),
  EMAIL_LOGS_PER_USER: parseInt(process.env.PERF_EMAIL_LOGS_PER_USER || "10", 10),
  CLEAN_FIRST: process.env.PERF_CLEAN_FIRST === "true",
} as const;

interface PerfStats {
  users: number;
  goals: number;
  dailyTasks: number;
  checkins: number;
  aiJobs: number;
  emailLogs: number;
  growthEvents: number;
  durationMs: number;
}

async function main() {
  console.log("🚀 GoalMate Performance Data Generator");
  console.log("Configuration:", JSON.stringify(CONFIG, null, 2));

  const startedAt = Date.now();

  if (CONFIG.CLEAN_FIRST) {
    await cleanPerfData();
  }

  const stats: PerfStats = {
    users: 0,
    goals: 0,
    dailyTasks: 0,
    checkins: 0,
    aiJobs: 0,
    emailLogs: 0,
    growthEvents: 0,
    durationMs: 0,
  };

  // Check existing data
  const existingUsers = await prisma.user.count({
    where: { email: { startsWith: CONFIG.PREFIX } },
  });
  if (existingUsers > 0) {
    console.log(`Found ${existingUsers} existing perf users, skipping generation.`);
    console.log('Set PERF_CLEAN_FIRST=true to remove existing data first.');
    return;
  }

  const passwordHash =
    "$2b$10$" + randomBytes(32).toString("base64").slice(0, 53); // Fake hash

  // Generate users
  console.log(`Generating ${CONFIG.USER_COUNT} users...`);
  const userCreateData = Array.from({ length: CONFIG.USER_COUNT }, (_, i) => {
    const idx = String(i).padStart(4, "0");
    return {
      email: `${CONFIG.PREFIX}user${idx}@goalmate.test`,
      passwordHash,
      displayName: `Perf User ${idx}`,
      status: "ACTIVE" as const,
      membership: {
        create: {
          plan: i < CONFIG.USER_COUNT * 0.2 ? "PRO" as const : "FREE" as const,
          status: "ACTIVE" as const,
        },
      },
      notificationPreference: {
        create: {
          enabled: true,
          reminderTime: "09:00",
          reminderTypes: JSON.stringify(["DAILY_TASK"]),
          timezone: "Asia/Shanghai",
        },
      },
    };
  });

  const users: Array<{ id: string; email: string }> = [];
  for (const data of userCreateData) {
    const user = await prisma.user.create({ data, select: { id: true, email: true } });
    users.push(user);
  }
  stats.users = users.length;
  console.log(`  ✓ ${stats.users} users created`);

  // Generate goals and associated data per user
  const goalCategories = ["STUDY", "CAREER", "FITNESS", "HABIT", "CET_4_6", "IELTS_TOEFL"];
  const goalTitles = [
    "通过英语六级考试",
    "完成 Python 学习课程",
    "每天运动 30 分钟",
    "阅读 12 本书",
    "考研数学复习",
    "日语 N3 备考",
    "考取 AWS 认证",
    "学习 React 框架",
    "完成健身计划",
    "每日冥想习惯养成",
  ];
  const taskTitles = [
    "完成课后练习题",
    "背诵核心单词",
    "阅读教材章节",
    "完成模拟试卷",
    "复习错题集",
    "听力练习",
    "写作训练",
    "口语练习",
    "运动打卡",
    "冥想练习",
  ];

  const today = new Date();
  const baseDate = new Date(today);
  baseDate.setDate(baseDate.getDate() - CONFIG.TASK_DAYS);

  for (let u = 0; u < users.length; u++) {
    const user = users[u];
    if (u % 20 === 0) {
      console.log(`  Processing user ${u + 1}/${users.length}...`);
    }

    const goalCount = CONFIG.GOALS_PER_USER + randomInt(0, 3);
    const userGoalIds: string[] = [];

    for (let g = 0; g < goalCount; g++) {
      const startDate = new Date(baseDate);
      startDate.setDate(startDate.getDate() + randomInt(0, 7));
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 60 + randomInt(0, 60));

      const goalStatus: string = endDate > today ? "ACTIVE" : (Math.random() > 0.3 ? "COMPLETED" : "FAILED");
      const title = goalTitles[g % goalTitles.length];

      const goal = await prisma.goal.create({
        data: {
          userId: user.id,
          title,
          description: `性能测试目标: ${title}`,
          category: goalCategories[g % goalCategories.length] as any,
          status: goalStatus as any,
          startDate,
          endDate,
          toleranceDaysAllowed: randomInt(0, 5),
          toleranceDaysUsed: randomInt(0, 3),
          dailyTimeBudgetMinutes: 60 + randomInt(0, 120),
          subjects: JSON.stringify(["数学", "英语", "专业课"].slice(0, randomInt(1, 4))),
          materials: JSON.stringify(["教材", "题库"]),
          timezone: "Asia/Shanghai",
        },
      });
      userGoalIds.push(goal.id);
      stats.goals++;

      // Generate daily tasks
      for (let d = 0; d < CONFIG.TASK_DAYS; d++) {
        const taskDate = new Date(baseDate);
        taskDate.setDate(taskDate.getDate() + d);
        if (taskDate < startDate || taskDate > today) continue;

        const tasksToday = Math.min(CONFIG.TASKS_PER_DAY, 3 + randomInt(0, 3));
        for (let t = 0; t < tasksToday; t++) {
          const isCompleted = taskDate < today && Math.random() < CONFIG.CHECKIN_RATE;
          const title = taskTitles[t % taskTitles.length];
          const dailyTask = await prisma.dailyTask.create({
            data: {
              goalId: goal.id,
              taskDate,
              title,
              description: `性能测试任务: ${title}`,
              plannedMinutes: 30 + randomInt(0, 90),
              studyTaskType: t === 0 ? "EXERCISE" : t === 1 ? "MEMORIZATION" : "READING",
              subject: ["数学", "英语", "专业课"][randomInt(0, 3)],
              taskType: "NORMAL",
              status: isCompleted ? "COMPLETED" : "PENDING",
            },
          });
          stats.dailyTasks++;

          // Generate checkins for completed tasks
          if (isCompleted) {
            const checkin = await prisma.checkin.create({
              data: {
                userId: user.id,
                goalId: goal.id,
                dailyTaskId: dailyTask.id,
                status: "SCORED",
                content: `完成了 ${title} 的学习任务`,
                investedMinutes: dailyTask.plannedMinutes || 30 + randomInt(-10, 20),
                studyMood: ["😊 积极", "😐 一般", "😞 困难"][randomInt(0, 3)],
                difficultyLevel: ["EASY", "MEDIUM", "HARD"][randomInt(0, 3)],
              },
            });
            stats.checkins++;

            // Growth event for checkin scored
            await prisma.growthEvent.create({
              data: {
                userId: user.id,
                goalId: goal.id,
                type: "CHECKIN_SCORED",
                sourceResourceType: "CHECKIN",
                sourceResourceId: checkin.id,
                occurredAt: taskDate,
                metadata: JSON.stringify({ derived: true }),
                derived: true,
              },
            });
            stats.growthEvents++;
          }
        }
      }

      // Generate AI jobs
      const aiJobTypes = ["PLAN_GENERATION", "CHECKIN_SCORING", "TREND_REPORT"];
      for (let j = 0; j < CONFIG.AI_JOBS_PER_GOAL; j++) {
        const jobType = aiJobTypes[j % aiJobTypes.length];
        const jobStatus = Math.random() > 0.2 ? "SUCCEEDED" : (Math.random() > 0.5 ? "FAILED" : "QUEUED");
        await prisma.aiJob.create({
          data: {
            userId: user.id,
            goalId: goal.id,
            type: jobType,
            status: jobStatus as any,
            attempts: jobStatus === "SUCCEEDED" ? 1 : randomInt(1, 4),
            payload: JSON.stringify({ perf: true }),
            result: jobStatus === "SUCCEEDED" ? JSON.stringify({ score: 80 }) : undefined,
            error: jobStatus === "FAILED" ? "模拟 AI 调用失败" : undefined,
          },
        });
        stats.aiJobs++;
      }

      // Growth event for goal created
      await prisma.growthEvent.create({
        data: {
          userId: user.id,
          goalId: goal.id,
          type: "GOAL_CREATED",
          sourceResourceType: "GOAL",
          sourceResourceId: goal.id,
          occurredAt: startDate,
          metadata: JSON.stringify({ derived: true }),
          derived: true,
        },
      });
      stats.growthEvents++;
    }

    // Generate email logs
    const emailTypes = ["DAILY_TASK", "CHECKIN_REMINDER", "WEEKLY_REPORT"];
    for (let e = 0; e < CONFIG.EMAIL_LOGS_PER_USER; e++) {
      await prisma.emailLog.create({
        data: {
          userId: user.id,
          goalId: userGoalIds.length > 0 ? userGoalIds[randomInt(0, userGoalIds.length)] : null,
          channel: "EMAIL",
          type: emailTypes[e % emailTypes.length],
          recipientEmail: user.email,
          subject: `性能测试通知 #${e}`,
          content: "性能测试邮件内容",
          status: Math.random() > 0.9 ? "FAILED" : "SENT",
          provider: "mock",
          source: "SCHEDULER",
          dedupeKey: `${CONFIG.PREFIX}email_${user.id}_${e}`,
        },
      });
      stats.emailLogs++;
    }
  }

  stats.durationMs = Date.now() - startedAt;

  console.log("\n📊 Generation Complete");
  console.log("──────────────────────────────");
  console.log(`  Users:         ${stats.users}`);
  console.log(`  Goals:         ${stats.goals}`);
  console.log(`  Daily Tasks:   ${stats.dailyTasks}`);
  console.log(`  Checkins:      ${stats.checkins}`);
  console.log(`  AI Jobs:       ${stats.aiJobs}`);
  console.log(`  Email Logs:    ${stats.emailLogs}`);
  console.log(`  Growth Events: ${stats.growthEvents}`);
  console.log(`  Duration:      ${(stats.durationMs / 1000).toFixed(2)}s`);
  console.log("──────────────────────────────");
  console.log(`\nCleanup: Set PERF_CLEAN_FIRST=true and re-run, or run:`);
  console.log(`  DELETE FROM users WHERE email LIKE '${CONFIG.PREFIX}%';`);
}

async function cleanPerfData() {
  console.log("🧹 Cleaning existing performance test data...");

  // Delete in dependency order
  const emailLogs = await prisma.emailLog.deleteMany({
    where: { dedupeKey: { startsWith: CONFIG.PREFIX } },
  });
  console.log(`  Deleted ${emailLogs.count} email logs`);

  const aiJobs = await prisma.aiJob.deleteMany({
    where: { payload: { equals: JSON.stringify({ perf: true }) } } as any,
  });
  console.log(`  Deleted ${aiJobs.count} AI jobs`);

  const growthEvents = await prisma.growthEvent.deleteMany({
    where: { user: { email: { startsWith: CONFIG.PREFIX } } },
  });
  console.log(`  Deleted ${growthEvents.count} growth events (derived)`);

  const checkins = await prisma.checkin.deleteMany({
    where: { goal: { user: { email: { startsWith: CONFIG.PREFIX } } } },
  });
  console.log(`  Deleted ${checkins.count} checkins`);

  const dailyTasks = await prisma.dailyTask.deleteMany({
    where: { goal: { user: { email: { startsWith: CONFIG.PREFIX } } } },
  });
  console.log(`  Deleted ${dailyTasks.count} daily tasks`);

  const goals = await prisma.goal.deleteMany({
    where: { user: { email: { startsWith: CONFIG.PREFIX } } },
  });
  console.log(`  Deleted ${goals.count} goals`);

  const notificationPrefs = await prisma.notificationPreference.deleteMany({
    where: { user: { email: { startsWith: CONFIG.PREFIX } } },
  });
  console.log(`  Deleted ${notificationPrefs.count} notification preferences`);

  const memberships = await prisma.membership.deleteMany({
    where: { user: { email: { startsWith: CONFIG.PREFIX } } },
  });
  console.log(`  Deleted ${memberships.count} memberships`);

  const users = await prisma.user.deleteMany({
    where: { email: { startsWith: CONFIG.PREFIX } },
  });
  console.log(`  Deleted ${users.count} users`);

  console.log("  ✓ Cleanup complete\n");
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

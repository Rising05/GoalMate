import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { EmailLog, NotificationPreference, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { MAIL_PROVIDER, MailProvider } from "./mail-provider";
import { MockMailProvider } from "./mock-mail.provider";

const DEFAULT_REMINDER_TYPES = [
  "DAILY_TASK",
  "MISSED_CHECKIN",
  "TOLERANCE_RISK",
  "MILESTONE",
  "FAILURE_REVIEW",
  "MEMBERSHIP_EXPIRY"
] as const;

const REMINDER_TYPE_LABELS: Record<string, string> = {
  DAILY_TASK: "每日任务提醒",
  MISSED_CHECKIN: "当天未打卡提醒",
  TOLERANCE_RISK: "容错次数即将耗尽提醒",
  MILESTONE: "阶段里程碑提醒",
  FAILURE_REVIEW: "失败复盘提醒",
  MEMBERSHIP_EXPIRY: "会员到期提醒"
};
const MAX_EMAIL_ATTEMPTS = 3;

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(MAIL_PROVIDER)
    private readonly mailProvider: MailProvider = new MockMailProvider(),
    @Optional()
    @Inject(QueueService)
    private readonly queueService?: QueueService
  ) {}

  async getPreference(userId: string) {
    const preference = await this.ensurePreference(userId);
    return this.serializePreference(preference);
  }

  async updatePreference(userId: string, input: unknown) {
    const payload = this.parsePreferencePayload(input);
    const preference = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        enabled: payload.enabled,
        reminderTime: payload.reminderTime,
        reminderTypes: this.toJson(payload.reminderTypes),
        timezone: payload.timezone
      },
      update: {
        enabled: payload.enabled,
        reminderTime: payload.reminderTime,
        reminderTypes: this.toJson(payload.reminderTypes),
        timezone: payload.timezone
      }
    });

    return this.serializePreference(preference);
  }

  async listEmailLogs(userId: string) {
    const logs = await this.prisma.emailLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30
    });

    return {
      logs: logs.map((log) => this.serializeEmailLog(log))
    };
  }

  async createPreviewEmailLog(userId: string, input: unknown) {
    const preference = await this.ensurePreference(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true
      }
    });

    if (!user) {
      throw new NotFoundException("用户不存在");
    }

    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const type = this.parseReminderType(body.type) ?? "DAILY_TASK";
    const scheduledFor =
      typeof body.scheduledFor === "string" && body.scheduledFor.trim()
        ? this.parseNow({ now: body.scheduledFor })
        : this.getNextScheduledAt(preference.reminderTime);
    const subject = REMINDER_TYPE_LABELS[type] ?? "GoalMate 提醒";
    const log = await this.prisma.emailLog.create({
      data: {
        userId,
        goalId: typeof body.goalId === "string" ? body.goalId : null,
        type,
        recipientEmail: user.email,
        subject,
        content: this.buildPreviewEmailContent(type, preference),
        status: preference.enabled ? "QUEUED" : "SKIPPED",
        scheduledFor
      }
    });
    await this.enqueueEmailLog(log);

    return {
      log: this.serializeEmailLog(log)
    };
  }

  async enqueueDueEmailLogs(userId: string, input: unknown = {}) {
    const now = this.parseNow(input);
    const preference = await this.ensurePreference(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        goals: {
          where: {
            status: {
              in: ["ACTIVE", "AT_RISK", "REPLANNING", "FAILED"]
            }
          },
          include: {
            dailyTasks: {
              where: this.todayTaskWhere(now),
              orderBy: { taskDate: "asc" }
            },
            milestones: {
              where: this.todayMilestoneWhere(now),
              orderBy: { targetDate: "asc" }
            },
            failureReport: true
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundException("用户不存在");
    }

    if (!preference.enabled) {
      return {
        queued: [],
        skipped: ["邮件提醒已关闭"]
      };
    }

    const scheduledFor = this.getScheduledAt(preference.reminderTime, now);

    if (scheduledFor > now) {
      return {
        queued: [],
        skipped: ["尚未到达今日提醒时间"]
      };
    }

    const reminderTypes = new Set(this.jsonStringArray(preference.reminderTypes));
    const candidates = this.buildDueEmailCandidates(user, reminderTypes, preference, now);
    const queued: EmailLog[] = [];
    const skipped: string[] = [];

    for (const candidate of candidates) {
      const exists = await this.prisma.emailLog.findFirst({
        where: {
          userId,
          goalId: candidate.goalId,
          type: candidate.type,
          scheduledFor: this.todayDateWhere(now)
        },
        select: { id: true }
      });

      if (exists) {
        skipped.push(`${candidate.type} 已存在`);
        continue;
      }

      const log = await this.prisma.emailLog.create({
        data: {
          userId,
          goalId: candidate.goalId,
          type: candidate.type,
          recipientEmail: user.email,
          subject: candidate.subject,
          content: candidate.content,
          status: "QUEUED",
          scheduledFor
        }
      });
      await this.enqueueEmailLog(log);
      queued.push(log);
    }

    return {
      queued: queued.map((log) => this.serializeEmailLog(log)),
      skipped
    };
  }

  async processQueuedEmailLogs(userId: string, input: unknown = {}) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const now = this.parseNow(input);
    const limitValue = Number(body.limit ?? 20);
    const limit = Number.isInteger(limitValue)
      ? Math.min(50, Math.max(1, limitValue))
      : 20;
    const simulateFailure = body.simulateFailure === true;
    const queuedLogs = await this.prisma.emailLog.findMany({
      where: {
        userId,
        status: "QUEUED",
        attempts: {
          lt: MAX_EMAIL_ATTEMPTS
        },
        scheduledFor: {
          lte: now
        }
      },
      orderBy: { scheduledFor: "asc" },
      take: limit
    });
    const processed: EmailLog[] = [];

    for (const log of queuedLogs) {
      const result = await this.mailProvider.send(log, { simulateFailure });
      processed.push(
        await this.prisma.emailLog.update({
          where: { id: log.id },
          data: result.status === "FAILED"
            ? {
                status: "FAILED",
                attempts: {
                  increment: 1
                },
                error: result.error ?? "Mail provider failed",
                sentAt: null
              }
            : {
                status: "SENT",
                attempts: {
                  increment: 1
                },
                error: null,
                sentAt: now
              }
        })
      );
    }

    return {
      processed: processed.map((log) => this.serializeEmailLog(log)),
      sent: processed.filter((log) => log.status === "SENT").length,
      failed: processed.filter((log) => log.status === "FAILED").length
    };
  }

  async retryFailedEmailLogs(userId: string, input: unknown = {}) {
    const now = this.parseNow(input);
    const failedLogs = await this.prisma.emailLog.findMany({
      where: {
        userId,
        status: "FAILED",
        attempts: {
          lt: MAX_EMAIL_ATTEMPTS
        }
      },
      orderBy: {
        updatedAt: "asc"
      },
      take: 20
    });
    const retried: EmailLog[] = [];

    for (const log of failedLogs) {
      const retryLog = await this.prisma.emailLog.update({
        where: {
          id: log.id
        },
        data: {
          status: "QUEUED",
          error: null,
          scheduledFor: now,
          sentAt: null
        }
      });
      await this.enqueueEmailLog(retryLog);
      retried.push(retryLog);
    }

    return {
      retried: retried.map((log) => this.serializeEmailLog(log)),
      skipped: failedLogs.length === 0 ? ["暂无可重试的失败邮件"] : []
    };
  }

  private async ensurePreference(userId: string) {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId }
    });

    if (existing) {
      return existing;
    }

    return this.prisma.notificationPreference.create({
      data: {
        userId,
        enabled: true,
        reminderTime: "09:00",
        reminderTypes: this.toJson([...DEFAULT_REMINDER_TYPES]),
        timezone: "Asia/Shanghai"
      }
    });
  }

  private async enqueueEmailLog(log: EmailLog) {
    try {
      await this.queueService?.enqueueEmailLog({
        emailLogId: log.id,
        userId: log.userId,
        type: log.type
      });
    } catch {
      // Queue enqueue failure must not prevent persisting the email log.
    }
  }

  private buildDueEmailCandidates(
    user: NonNullable<
      Awaited<
        ReturnType<NotificationsService["getUserForReminderCandidates"]>
      >
    >,
    reminderTypes: Set<string>,
    preference: NotificationPreference,
    now: Date
  ) {
    const candidates: Array<{
      type: string;
      goalId: string | null;
      subject: string;
      content: string;
    }> = [];
    const activeGoals = user.goals.filter((goal) =>
      ["ACTIVE", "AT_RISK", "REPLANNING"].includes(goal.status)
    );

    for (const goal of activeGoals) {
      const pendingTasks = goal.dailyTasks.filter((task) => task.status !== "DONE");
      const doneTasks = goal.dailyTasks.filter((task) => task.status === "DONE");

      if (reminderTypes.has("DAILY_TASK") && pendingTasks.length) {
        candidates.push({
          type: "DAILY_TASK",
          goalId: goal.id,
          subject: "今日任务提醒",
          content: this.buildReminderContent(
            "DAILY_TASK",
            preference,
            `目标「${goal.title}」今天还有 ${pendingTasks.length} 个任务待完成。`,
            this.buildEncouragement("DAILY_TASK", {
              pendingTaskCount: pendingTasks.length,
              doneTaskCount: doneTasks.length
            })
          )
        });
      }

      if (
        reminderTypes.has("MISSED_CHECKIN") &&
        pendingTasks.length &&
        doneTasks.length === 0
      ) {
        candidates.push({
          type: "MISSED_CHECKIN",
          goalId: goal.id,
          subject: "今日尚未打卡提醒",
          content: this.buildReminderContent(
            "MISSED_CHECKIN",
            preference,
            `目标「${goal.title}」今天还没有完成记录，可先完成一个最小任务。`,
            this.buildEncouragement("MISSED_CHECKIN", {
              pendingTaskCount: pendingTasks.length,
              doneTaskCount: doneTasks.length
            })
          )
        });
      }

      if (
        reminderTypes.has("TOLERANCE_RISK") &&
        goal.toleranceDaysAllowed > 0 &&
        goal.toleranceDaysUsed >= goal.toleranceDaysAllowed - 1
      ) {
        candidates.push({
          type: "TOLERANCE_RISK",
          goalId: goal.id,
          subject: "容错次数即将耗尽",
          content: this.buildReminderContent(
            "TOLERANCE_RISK",
            preference,
            `目标「${goal.title}」已使用 ${goal.toleranceDaysUsed}/${goal.toleranceDaysAllowed} 次容错。`,
            "今天只守住一个最小动作。"
          )
        });
      }

      if (reminderTypes.has("MILESTONE") && goal.milestones.length) {
        candidates.push({
          type: "MILESTONE",
          goalId: goal.id,
          subject: "阶段里程碑提醒",
          content: this.buildReminderContent(
            "MILESTONE",
            preference,
            `目标「${goal.title}」今天有 ${goal.milestones.length} 个阶段里程碑需要关注。`,
            "先检查进度，再决定下一步。"
          )
        });
      }
    }

    for (const goal of user.goals.filter((goal) => goal.status === "FAILED")) {
      if (reminderTypes.has("FAILURE_REVIEW") && goal.failureReport) {
        candidates.push({
          type: "FAILURE_REVIEW",
          goalId: goal.id,
          subject: "失败复盘提醒",
          content: this.buildReminderContent(
            "FAILURE_REVIEW",
            preference,
            `目标「${goal.title}」已有失败复盘，可根据建议重新开启一个更小的新目标。`,
            "复盘是下一次开始的材料。"
          )
        });
      }
    }

    if (
      reminderTypes.has("MEMBERSHIP_EXPIRY") &&
      user.membership?.plan === "PRO" &&
      user.membership.expiresAt
    ) {
      const daysUntilExpiry = Math.ceil(
        (user.membership.expiresAt.getTime() - now.getTime()) / 86_400_000
      );

      if (daysUntilExpiry >= 0 && daysUntilExpiry <= 7) {
        candidates.push({
          type: "MEMBERSHIP_EXPIRY",
          goalId: null,
          subject: "会员到期提醒",
          content: this.buildReminderContent(
            "MEMBERSHIP_EXPIRY",
            preference,
            `PRO 会员将在 ${daysUntilExpiry} 天后到期。`,
            "重要分析建议提前保存。"
          )
        });
      }
    }

    return candidates;
  }

  private getUserForReminderCandidates(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        goals: {
          include: {
            dailyTasks: true,
            milestones: true,
            failureReport: true
          }
        }
      }
    });
  }

  private buildReminderContent(
    type: string,
    preference: NotificationPreference,
    detail: string,
    encouragement?: string
  ) {
    const encouragementText = encouragement ? ` 鼓励：${encouragement}` : "";
    return `${REMINDER_TYPE_LABELS[type] ?? "GoalMate 提醒"}：${detail}${encouragementText} 当前提醒时间为北京时间 ${preference.reminderTime}。`;
  }

  private buildEncouragement(
    type: string,
    progress: {
      pendingTaskCount: number;
      doneTaskCount: number;
    }
  ) {
    if (type === "MISSED_CHECKIN") {
      return "先做10分钟，也算重新开始。";
    }

    if (progress.doneTaskCount > 0) {
      return "已完成一部分，继续收尾。";
    }

    if (progress.pendingTaskCount <= 1) {
      return "先完成这一项就够了。";
    }

    return "从最小的一项开始。";
  }

  private parsePreferencePayload(input: unknown) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const reminderTime =
      typeof body.reminderTime === "string" ? body.reminderTime.trim() : "";
    const timezone =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim().slice(0, 80)
        : "Asia/Shanghai";
    const reminderTypes = this.parseReminderTypes(body.reminderTypes);

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
      throw new BadRequestException("提醒时间必须是 HH:mm 格式");
    }

    if (!reminderTypes.length) {
      throw new BadRequestException("至少选择一种提醒类型");
    }

    return {
      enabled,
      reminderTime,
      reminderTypes,
      timezone
    };
  }

  private parseReminderTypes(value: unknown) {
    if (!Array.isArray(value)) {
      return [...DEFAULT_REMINDER_TYPES];
    }

    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
          .filter((item) => item in REMINDER_TYPE_LABELS)
      )
    );
  }

  private parseReminderType(value: unknown) {
    if (typeof value !== "string") {
      return null;
    }

    const type = value.trim().toUpperCase();
    return type in REMINDER_TYPE_LABELS ? type : null;
  }

  private parseNow(input: unknown) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};

    if (typeof body.now !== "string" || !body.now.trim()) {
      return new Date();
    }

    const now = new Date(body.now);

    if (Number.isNaN(now.getTime())) {
      throw new BadRequestException("当前时间格式不正确");
    }

    return now;
  }

  private todayDateWhere(now: Date) {
    const todayKey = this.toDateKey(now);
    const start = new Date(`${todayKey}T00:00:00.000+08:00`);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    return {
      gte: start,
      lt: end
    };
  }

  private todayTaskWhere(now: Date) {
    return {
      taskDate: this.todayDateWhere(now)
    };
  }

  private todayMilestoneWhere(now: Date) {
    return {
      targetDate: this.todayDateWhere(now)
    };
  }

  private getScheduledAt(reminderTime: string, now: Date) {
    const todayKey = this.toDateKey(now);
    return new Date(`${todayKey}T${reminderTime}:00.000+08:00`);
  }

  private getNextScheduledAt(reminderTime: string) {
    const todayKey = this.toDateKey(new Date());
    const scheduled = new Date(`${todayKey}T${reminderTime}:00.000+08:00`);

    if (scheduled <= new Date()) {
      scheduled.setUTCDate(scheduled.getUTCDate() + 1);
    }

    return scheduled;
  }

  private buildPreviewEmailContent(
    type: string,
    preference: NotificationPreference
  ) {
    const enabledText = preference.enabled ? "已开启" : "已关闭";
    return `这是一条 ${REMINDER_TYPE_LABELS[type] ?? "GoalMate 提醒"} 预览。当前邮件提醒${enabledText}，每日 ${preference.reminderTime} 按北京时间计算。`;
  }

  private serializePreference(preference: NotificationPreference) {
    return {
      id: preference.id,
      userId: preference.userId,
      enabled: preference.enabled,
      reminderTime: preference.reminderTime,
      reminderTypes: this.jsonStringArray(preference.reminderTypes),
      timezone: preference.timezone,
      createdAt: preference.createdAt.toISOString(),
      updatedAt: preference.updatedAt.toISOString(),
      availableTypes: DEFAULT_REMINDER_TYPES.map((type) => ({
        code: type,
        label: REMINDER_TYPE_LABELS[type]
      }))
    };
  }

  private serializeEmailLog(log: EmailLog) {
    return {
      id: log.id,
      userId: log.userId,
      goalId: log.goalId,
      type: log.type,
      recipientEmail: log.recipientEmail,
      subject: log.subject,
      content: log.content,
      status: log.status,
      attempts: log.attempts,
      error: log.error,
      scheduledFor: log.scheduledFor?.toISOString() ?? null,
      sentAt: log.sentAt?.toISOString() ?? null,
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString()
    };
  }

  private jsonStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  }

  private toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private toDateKey(date: Date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return `${year}-${month}-${day}`;
  }
}

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { EmailLog, NotificationPreference, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { TraceContextService } from "../observability/trace-context.service";
import { MAIL_PROVIDER, MailProvider } from "./mail-provider";
import { MockMailProvider } from "./mock-mail.provider";
import { MockWechatProvider } from "./mock-wechat.provider";
import { WECHAT_PROVIDER, WechatProvider } from "./wechat-provider";
import { FieldEncryptionService } from "../security/field-encryption.service";

const DEFAULT_REMINDER_TYPES = [
  "DAILY_TASK",
  "MISSED_CHECKIN",
  "TOLERANCE_RISK",
  "MILESTONE",
  "FAILURE_REVIEW",
  "MEMBERSHIP_EXPIRY",
  "DEVIATION_WARNING",
  "RESCUE_TASK",
  "WEEKLY_REPORT",
  "MONTHLY_REPORT",
  "EXAM_SPRINT"
] as const;
const DEFAULT_NOTIFICATION_CHANNELS = ["EMAIL"] as const;

const REMINDER_TYPE_LABELS: Record<string, string> = {
  DAILY_TASK: "每日任务提醒",
  MISSED_CHECKIN: "当天未打卡提醒",
  TOLERANCE_RISK: "容错次数即将耗尽提醒",
  MILESTONE: "阶段里程碑提醒",
  FAILURE_REVIEW: "失败复盘提醒",
  MEMBERSHIP_EXPIRY: "会员到期提醒",
  DEVIATION_WARNING: "偏差预警提醒",
  RESCUE_TASK: "救援任务提醒",
  WEEKLY_REPORT: "周报提醒",
  MONTHLY_REPORT: "月报提醒",
  EXAM_SPRINT: "考前冲刺提醒"
};
const CHANNEL_LABELS: Record<string, string> = {
  WEB: "Web 站内",
  EMAIL: "邮件",
  WECHAT: "微信提醒"
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
    private readonly queueService?: QueueService,
    @Optional()
    @Inject(WECHAT_PROVIDER)
    private readonly wechatProvider: WechatProvider = new MockWechatProvider(),
    @Optional()
    @Inject(TraceContextService)
    private readonly traces: TraceContextService = new TraceContextService(),
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fields: FieldEncryptionService = new FieldEncryptionService()
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
        channels: this.toJson(payload.channels),
        timezone: payload.timezone,
        silentDays: this.toJson(payload.silentDays),
        examSprintDays: payload.examSprintDays
      },
      update: {
        enabled: payload.enabled,
        reminderTime: payload.reminderTime,
        reminderTypes: this.toJson(payload.reminderTypes),
        channels: this.toJson(payload.channels),
        timezone: payload.timezone,
        silentDays: this.toJson(payload.silentDays),
        examSprintDays: payload.examSprintDays
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

  async getWechatBinding(userId: string) {
    const binding = await this.prisma.wechatBinding.findUnique({
      where: { userId }
    });

    return {
      binding: binding ? this.serializeWechatBinding(binding) : null
    };
  }

  async bindWechat(userId: string, input: unknown) {
    const payload = this.parseWechatBindingPayload(input);
    const openIdHash = this.fields.blindIndex(payload.openId);
    const unionIdHash = this.fields.blindIndex(payload.unionId);
    const existing = await this.prisma.wechatBinding.findFirst({
      where: {
        OR: [
          { openIdHash },
          ...(unionIdHash ? [{ unionIdHash }] : [])
        ],
        NOT: { userId }
      }
    });

    if (existing) {
      throw new BadRequestException("该微信账号已绑定其他用户");
    }

    const openId = this.fields.encrypt(payload.openId);
    const unionId = this.fields.encryptNullable(payload.unionId);
    const binding = await this.prisma.wechatBinding.upsert({
      where: { userId },
      create: {
        userId,
        openId: openId.ciphertext,
        openIdHash,
        openIdKeyVersion: openId.keyVersion,
        unionId: unionId.ciphertext,
        unionIdHash,
        unionIdKeyVersion: unionId.ciphertext ? unionId.keyVersion : undefined,
        nickname: payload.nickname,
        avatarUrl: payload.avatarUrl,
        status: "ACTIVE"
      },
      update: {
        openId: openId.ciphertext,
        openIdHash,
        openIdKeyVersion: openId.keyVersion,
        unionId: unionId.ciphertext,
        unionIdHash,
        unionIdKeyVersion: unionId.ciphertext ? unionId.keyVersion : null,
        nickname: payload.nickname,
        avatarUrl: payload.avatarUrl,
        status: "ACTIVE",
        boundAt: new Date()
      }
    });

    return {
      binding: this.serializeWechatBinding(binding)
    };
  }

  async unbindWechat(userId: string) {
    const binding = await this.prisma.wechatBinding.findUnique({
      where: { userId }
    });

    if (!binding) {
      return {
        unbound: false
      };
    }

    await this.prisma.wechatBinding.delete({
      where: { userId }
    });

    return {
      unbound: true
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
        : this.getNextScheduledAt(preference.reminderTime, preference.timezone);
    const subject = REMINDER_TYPE_LABELS[type] ?? "GoalMate 提醒";
    const log = await this.prisma.emailLog.create({
      data: {
        traceId: this.traces.getTraceId(),
        userId,
        goalId: typeof body.goalId === "string" ? body.goalId : null,
        type,
        recipientEmail: user.email,
        subject,
        content: this.buildPreviewEmailContent(type, preference),
        status: preference.enabled ? "QUEUED" : "SKIPPED",
        source: "PREVIEW",
        skipReason: preference.enabled ? null : "提醒总开关已关闭",
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
    const metadata = this.parseSchedulingMetadata(input);
    const preference = await this.ensurePreference(userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: true,
        wechatBinding: true,
        goals: {
          where: {
            status: {
              in: ["ACTIVE", "AT_RISK", "REPLANNING", "FAILED"]
            }
          },
          include: {
            dailyTasks: {
              where: this.todayTaskWhere(now, preference.timezone),
              orderBy: { taskDate: "asc" }
            },
            milestones: {
              where: this.todayMilestoneWhere(now, preference.timezone),
              orderBy: { targetDate: "asc" }
            },
            failureReport: true,
            reportArtifacts: {
              where: {
                updatedAt: this.todayDateWhere(now, preference.timezone)
              },
              orderBy: { updatedAt: "desc" },
              take: 4
            }
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

    if (this.isSilentDay(preference, now)) {
      return {
        queued: [],
        skipped: ["今天是静默日"]
      };
    }

    const scheduledFor = this.getScheduledAt(
      preference.reminderTime,
      now,
      preference.timezone
    );

    if (scheduledFor > now) {
      return {
        queued: [],
        skipped: ["尚未到达今日提醒时间"]
      };
    }

    const reminderTypes = new Set(this.jsonStringArray(preference.reminderTypes));
    const channels = this.getDeliveryChannels(preference);
    const candidates = this.buildDueEmailCandidates(user, reminderTypes, preference, now);
    const queued: EmailLog[] = [];
    const skipped: string[] = [];

    for (const candidate of candidates) {
      for (const channel of channels) {
        const recipient = this.getChannelRecipient(channel, user);
        const dedupeKey = this.buildDedupeKey({
          userId,
          goalId: candidate.goalId,
          channel,
          type: candidate.type,
          now,
          timezone: preference.timezone
        });

        if (!recipient) {
          await this.createScheduledLog({
            userId,
            goalId: candidate.goalId,
            channel,
            type: candidate.type,
            recipientEmail: user.email,
            subject: candidate.subject,
            content: candidate.content,
            status: "SKIPPED",
            scheduledFor,
            source: metadata.source,
            schedulerRunId: metadata.schedulerRunId,
            dedupeKey,
            skipReason: `${channel} 未绑定或不可用`
          });
          skipped.push(`${candidate.type} ${channel} 未绑定`);
          continue;
        }

        const exists = await this.prisma.emailLog.findFirst({
          where: {
            userId,
            goalId: candidate.goalId,
            type: candidate.type,
            channel,
            dedupeKey
          },
          select: { id: true }
        });

        if (exists) {
          skipped.push(`${candidate.type} ${channel} 已存在`);
          continue;
        }

        const log = await this.createScheduledLog({
          userId,
          goalId: candidate.goalId,
          channel,
          type: candidate.type,
          recipientEmail: recipient,
          subject: candidate.subject,
          content: candidate.content,
          status: "QUEUED",
          scheduledFor,
          source: metadata.source,
          schedulerRunId: metadata.schedulerRunId,
          dedupeKey
        });

        if (!log.created) {
          skipped.push(`${candidate.type} ${channel} 已存在`);
          continue;
        }

        await this.enqueueEmailLog(log);
        queued.push(log);
      }
    }

    return {
      queued: queued.map((log) => this.serializeEmailLog(log)),
      skipped
    };
  }

  async runDueNotificationScan(input: unknown = {}) {
    const now = this.parseNow(input);
    const body = input && typeof input === "object"
      ? input as Record<string, unknown>
      : {};
    const source = body.source === "ADMIN_COMPENSATION"
      ? "ADMIN_COMPENSATION"
      : "AUTOMATIC";
    const schedulerRunId = this.cleanText(body.schedulerRunId, 120) || randomUUID();
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { enabled: true },
      select: { userId: true }
    });
    const results: Array<{
      userId: string;
      queued: number;
      skipped: string[];
      error?: string;
    }> = [];

    for (const preference of preferences) {
      try {
        const result = await this.enqueueDueEmailLogs(preference.userId, {
          now: now.toISOString(),
          source,
          schedulerRunId
        });
        results.push({
          userId: preference.userId,
          queued: result.queued.length,
          skipped: result.skipped
        });
      } catch (error) {
        results.push({
          userId: preference.userId,
          queued: 0,
          skipped: [],
          error: error instanceof Error ? error.message : "提醒调度失败"
        });
      }
    }

    return {
      schedulerRunId,
      source,
      scannedAt: now.toISOString(),
      usersScanned: preferences.length,
      logsQueued: results.reduce((total, result) => total + result.queued, 0),
      failures: results.filter((result) => result.error).length,
      results
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
        channel: {
          in: ["EMAIL", "WECHAT"]
        },
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
      const delivery = await this.deliverNotification(log, simulateFailure);
      const result = delivery.result;
      processed.push(
        await this.prisma.emailLog.update({
          where: { id: log.id },
          data: result.status === "FAILED"
            ? {
                status: "FAILED",
                attempts: {
                  increment: 1
                },
                provider: delivery.provider,
                providerMessageId: result.providerMessageId ?? null,
                errorCode: result.errorCode ?? null,
                error: result.error ?? "Mail provider failed",
                sentAt: null
              }
            : {
                status: "SENT",
                attempts: {
                  increment: 1
                },
                provider: delivery.provider,
                providerMessageId: result.providerMessageId ?? null,
                errorCode: null,
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

  async processQueuedEmailLog(emailLogId: string, input: unknown = {}) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const now = this.parseNow(input);
    const simulateFailure = body.simulateFailure === true;
    const finalAttempt = body.finalAttempt === true;
    const log = await this.prisma.emailLog.findUnique({
      where: { id: emailLogId }
    });

    if (!log) {
      throw new NotFoundException("提醒日志不存在");
    }

    if (!["EMAIL", "WECHAT"].includes(log.channel)) {
      return {
        log: this.serializeEmailLog(log),
        processed: false,
        reason: "Notification channel is not supported by the worker.",
        retryable: false
      };
    }

    if (log.status !== "QUEUED") {
      return {
        log: this.serializeEmailLog(log),
        processed: false,
        reason: "Email log is not queued.",
        retryable: false
      };
    }

    if (log.attempts >= MAX_EMAIL_ATTEMPTS) {
      return {
        log: this.serializeEmailLog(log),
        processed: false,
        reason: "Email log has reached the maximum attempts.",
        retryable: false
      };
    }

    if (log.scheduledFor && log.scheduledFor > now) {
      return {
        log: this.serializeEmailLog(log),
        processed: false,
        reason: "Email log is not due yet.",
        retryable: false
      };
    }

    const delivery = await this.deliverNotification(log, simulateFailure);
    const result = delivery.result;
    const nextAttempts = log.attempts + 1;

    if (result.status === "SENT") {
      const sentLog = await this.prisma.emailLog.update({
        where: { id: log.id },
        data: {
          status: "SENT",
          attempts: nextAttempts,
          provider: delivery.provider,
          providerMessageId: result.providerMessageId ?? null,
          errorCode: null,
          error: null,
          sentAt: now
        }
      });

      return {
        log: this.serializeEmailLog(sentLog),
        processed: true,
        sent: true,
        failed: false,
        retryable: false
      };
    }

    const retryable =
      result.retryable !== false &&
      !finalAttempt &&
      nextAttempts < MAX_EMAIL_ATTEMPTS;
    const failedLog = await this.prisma.emailLog.update({
      where: { id: log.id },
      data: {
        status: retryable ? "QUEUED" : "FAILED",
        attempts: nextAttempts,
        provider: delivery.provider,
        providerMessageId: result.providerMessageId ?? null,
        errorCode: result.errorCode ?? null,
        error: result.error ?? "Mail provider failed",
        sentAt: null
      }
    });

    return {
      log: this.serializeEmailLog(failedLog),
      processed: true,
      sent: false,
      failed: !retryable,
      retryable
    };
  }

  async retryFailedEmailLogs(userId: string, input: unknown = {}) {
    const now = this.parseNow(input);
    const failedLogs = await this.prisma.emailLog.findMany({
      where: {
        userId,
        channel: {
          in: ["EMAIL", "WECHAT"]
        },
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
          errorCode: null,
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
        channels: this.toJson([...DEFAULT_NOTIFICATION_CHANNELS]),
        timezone: "Asia/Shanghai",
        silentDays: this.toJson([]),
        examSprintDays: 14
      }
    });
  }

  private async enqueueEmailLog(log: EmailLog) {
    if (!["EMAIL", "WECHAT"].includes(log.channel)) {
      return;
    }

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

  private async deliverNotification(log: EmailLog, simulateFailure: boolean) {
    const provider = log.channel === "WECHAT"
      ? this.wechatProvider
      : this.mailProvider;
    const result = await provider.send(log, { simulateFailure });

    return {
      provider: provider.name,
      result
    };
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

      if (
        reminderTypes.has("DEVIATION_WARNING") &&
        (goal.status === "AT_RISK" ||
          goal.toleranceDaysUsed >= Math.max(0, goal.toleranceDaysAllowed - 1))
      ) {
        candidates.push({
          type: "DEVIATION_WARNING",
          goalId: goal.id,
          subject: "目标偏差预警",
          content: this.buildReminderContent(
            "DEVIATION_WARNING",
            preference,
            `目标「${goal.title}」已出现执行风险，请先检查未完成任务和容错余额。`,
            "降低今天的任务粒度，先恢复连续执行。"
          )
        });
      }

      const pendingRescueTasks = goal.dailyTasks.filter(
        (task) => task.taskType === "RESCUE" && task.status !== "DONE"
      );

      if (reminderTypes.has("RESCUE_TASK") && pendingRescueTasks.length) {
        candidates.push({
          type: "RESCUE_TASK",
          goalId: goal.id,
          subject: "救援任务待完成",
          content: this.buildReminderContent(
            "RESCUE_TASK",
            preference,
            `目标「${goal.title}」有 ${pendingRescueTasks.length} 个救援任务待完成。`,
            "先完成救援任务，再决定是否恢复原计划。"
          )
        });
      }

      for (const reportType of ["WEEKLY_REPORT", "MONTHLY_REPORT"] as const) {
        const artifactType = reportType === "WEEKLY_REPORT"
          ? "WEEKLY_TREND"
          : "MONTHLY_TREND";
        const artifact = goal.reportArtifacts.find(
          (item) => item.type === artifactType
        );

        if (reminderTypes.has(reportType) && artifact) {
          candidates.push({
            type: reportType,
            goalId: goal.id,
            subject: reportType === "WEEKLY_REPORT" ? "学习周报已生成" : "学习月报已生成",
            content: this.buildReminderContent(
              reportType,
              preference,
              `目标「${goal.title}」的${reportType === "WEEKLY_REPORT" ? "周报" : "月报"}已生成：${artifact.title}。`,
              "查看趋势后只选择一个建议执行。"
            )
          });
        }
      }

      if (reminderTypes.has("EXAM_SPRINT") && goal.examDate) {
        const daysUntilExam = Math.ceil(
          (goal.examDate.getTime() - now.getTime()) / 86_400_000
        );

        if (daysUntilExam >= 0 && daysUntilExam <= preference.examSprintDays) {
          candidates.push({
            type: "EXAM_SPRINT",
            goalId: goal.id,
            subject: "考前冲刺提醒",
            content: this.buildReminderContent(
              "EXAM_SPRINT",
              preference,
              `目标「${goal.title}」距离考试还有 ${daysUntilExam} 天。`,
              "优先复习错题和高频薄弱项，不再扩张新内容。"
            )
          });
        }
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
        wechatBinding: true,
        goals: {
          include: {
            dailyTasks: true,
            milestones: true,
            failureReport: true,
            reportArtifacts: true
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
    return `${REMINDER_TYPE_LABELS[type] ?? "GoalMate 提醒"}：${detail}${encouragementText} 当前提醒时间为 ${preference.timezone} ${preference.reminderTime}。`;
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
    const channels = this.parseChannels(body.channels);
    const silentDays = this.parseSilentDays(body.silentDays);
    const examSprintDays = Number(body.examSprintDays ?? 14);

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
      throw new BadRequestException("提醒时间必须是 HH:mm 格式");
    }

    if (!reminderTypes.length) {
      throw new BadRequestException("至少选择一种提醒类型");
    }

    if (!channels.length) {
      throw new BadRequestException("至少选择一种提醒渠道");
    }

    this.assertTimezone(timezone);

    if (!Number.isInteger(examSprintDays) || examSprintDays < 1 || examSprintDays > 60) {
      throw new BadRequestException("考前冲刺提醒天数必须是 1-60 的整数");
    }

    return {
      enabled,
      reminderTime,
      reminderTypes,
      channels,
      timezone,
      silentDays,
      examSprintDays
    };
  }

  private parseSilentDays(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(new Set(value.map(Number))).filter(
      (day) => Number.isInteger(day) && day >= 0 && day <= 6
    );
  }

  private assertTimezone(timezone: string) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException("提醒时区不是有效的 IANA 时区");
    }
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

  private parseChannels(value: unknown) {
    if (!Array.isArray(value)) {
      return [...DEFAULT_NOTIFICATION_CHANNELS];
    }

    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
          .filter((item) => item in CHANNEL_LABELS)
      )
    );
  }

  private parseWechatBindingPayload(input: unknown) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const openId = this.cleanText(body.openId, 120);
    const unionId = this.cleanText(body.unionId, 120) || undefined;
    const nickname = this.cleanText(body.nickname, 80) || undefined;
    const avatarUrl = this.cleanText(body.avatarUrl, 500) || undefined;

    if (!openId || openId.length < 6) {
      throw new BadRequestException("微信 openId 不正确");
    }

    return {
      openId,
      unionId,
      nickname,
      avatarUrl
    };
  }

  private cleanText(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }

  private parseSchedulingMetadata(input: unknown) {
    const body = input && typeof input === "object"
      ? input as Record<string, unknown>
      : {};
    const allowedSources = new Set([
      "MANUAL",
      "AUTOMATIC",
      "ADMIN_COMPENSATION"
    ]);
    const requestedSource = this.cleanText(body.source, 40).toUpperCase();

    return {
      source: allowedSources.has(requestedSource) ? requestedSource : "MANUAL",
      schedulerRunId: this.cleanText(body.schedulerRunId, 120) || null
    };
  }

  private async createScheduledLog(input: {
    userId: string;
    goalId: string | null;
    channel: string;
    type: string;
    recipientEmail: string;
    subject: string;
    content: string;
    status: string;
    scheduledFor: Date;
    source: string;
    schedulerRunId: string | null;
    dedupeKey: string;
    skipReason?: string | null;
  }): Promise<EmailLog & { created: boolean }> {
    try {
      const log = await this.prisma.emailLog.create({ data: { ...input, traceId: this.traces.getTraceId() } });
      return Object.assign(log, { created: true });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.emailLog.findUnique({
          where: { dedupeKey: input.dedupeKey }
        });

        if (existing) {
          return Object.assign(existing, { created: false });
        }
      }

      throw error;
    }
  }

  private getPreferenceChannels(preference: NotificationPreference) {
    const channels = this.jsonStringArray(preference.channels).filter(
      (channel) => channel in CHANNEL_LABELS
    );

    return channels.length ? channels : [...DEFAULT_NOTIFICATION_CHANNELS];
  }

  private getDeliveryChannels(preference: NotificationPreference) {
    return this.getPreferenceChannels(preference).filter((channel) =>
      ["EMAIL", "WECHAT"].includes(channel)
    );
  }

  private getChannelRecipient(
    channel: string,
    user: {
      email: string;
      wechatBinding?: {
        openId: string;
        status: string;
      } | null;
    }
  ) {
    if (channel === "EMAIL") {
      return user.email;
    }

    if (channel === "WECHAT" && user.wechatBinding?.status === "ACTIVE") {
      return this.fields.decrypt(user.wechatBinding.openId);
    }

    return null;
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

  private todayDateWhere(now: Date, timezone = "Asia/Shanghai") {
    const todayKey = this.toDateKey(now, timezone);
    const start = this.zonedDateTimeToUtc(todayKey, "00:00", timezone);
    const end = this.zonedDateTimeToUtc(
      this.addDateKeyDays(todayKey, 1),
      "00:00",
      timezone
    );

    return {
      gte: start,
      lt: end
    };
  }

  private todayTaskWhere(now: Date, timezone = "Asia/Shanghai") {
    return {
      taskDate: this.todayDateWhere(now, timezone)
    };
  }

  private todayMilestoneWhere(now: Date, timezone = "Asia/Shanghai") {
    return {
      targetDate: this.todayDateWhere(now, timezone)
    };
  }

  private getScheduledAt(reminderTime: string, now: Date, timezone: string) {
    const todayKey = this.toDateKey(now, timezone);
    return this.zonedDateTimeToUtc(todayKey, reminderTime, timezone);
  }

  private getNextScheduledAt(
    reminderTime: string,
    timezone: string,
    silentDays: number[] = []
  ) {
    const now = new Date();
    const todayKey = this.toDateKey(now, timezone);

    for (let offset = 0; offset <= 7; offset += 1) {
      const dateKey = this.addDateKeyDays(todayKey, offset);
      const scheduled = this.zonedDateTimeToUtc(dateKey, reminderTime, timezone);

      if (scheduled <= now || this.isDateKeySilent(dateKey, silentDays)) {
        continue;
      }

      return scheduled;
    }

    return this.zonedDateTimeToUtc(
      this.addDateKeyDays(todayKey, 1),
      reminderTime,
      timezone
    );
  }

  private buildPreviewEmailContent(
    type: string,
    preference: NotificationPreference
  ) {
    const enabledText = preference.enabled ? "已开启" : "已关闭";
    return `这是一条 ${REMINDER_TYPE_LABELS[type] ?? "GoalMate 提醒"} 预览。当前邮件提醒${enabledText}，每日 ${preference.reminderTime} 按 ${preference.timezone} 计算。`;
  }

  private serializePreference(preference: NotificationPreference) {
    return {
      id: preference.id,
      userId: preference.userId,
      enabled: preference.enabled,
      reminderTime: preference.reminderTime,
      reminderTypes: this.jsonStringArray(preference.reminderTypes),
      channels: this.getPreferenceChannels(preference),
      timezone: preference.timezone,
      silentDays: this.jsonNumberArray(preference.silentDays),
      examSprintDays: preference.examSprintDays,
      nextScheduledAt: this.getNextScheduledAt(
        preference.reminderTime,
        preference.timezone,
        this.jsonNumberArray(preference.silentDays)
      ).toISOString(),
      createdAt: preference.createdAt.toISOString(),
      updatedAt: preference.updatedAt.toISOString(),
      availableTypes: DEFAULT_REMINDER_TYPES.map((type) => ({
        code: type,
        label: REMINDER_TYPE_LABELS[type]
      })),
      availableChannels: Object.entries(CHANNEL_LABELS).map(([code, label]) => ({
        code,
        label
      }))
    };
  }

  private serializeEmailLog(log: EmailLog) {
    return {
      id: log.id,
      traceId: log.traceId,
      userId: log.userId,
      goalId: log.goalId,
      channel: log.channel,
      type: log.type,
      recipientEmail: log.recipientEmail,
      subject: log.subject,
      content: log.content,
      status: log.status,
      attempts: log.attempts,
      provider: log.provider,
      providerMessageId: log.providerMessageId,
      errorCode: log.errorCode,
      error: log.error,
      source: log.source,
      schedulerRunId: log.schedulerRunId,
      skipReason: log.skipReason,
      scheduledFor: log.scheduledFor?.toISOString() ?? null,
      sentAt: log.sentAt?.toISOString() ?? null,
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString()
    };
  }

  private serializeWechatBinding(binding: {
    id: string;
    userId: string;
    openId: string;
    unionId: string | null;
    nickname: string | null;
    avatarUrl: string | null;
    status: string;
    boundAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: binding.id,
      userId: binding.userId,
      openId: this.fields.decrypt(binding.openId),
      unionId: this.fields.decryptNullable(binding.unionId),
      nickname: binding.nickname,
      avatarUrl: binding.avatarUrl,
      status: binding.status,
      boundAt: binding.boundAt.toISOString(),
      createdAt: binding.createdAt.toISOString(),
      updatedAt: binding.updatedAt.toISOString()
    };
  }

  private jsonStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  }

  private jsonNumberArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is number => typeof item === "number");
  }

  private toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private toDateKey(date: Date, timezone = "Asia/Shanghai") {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return `${year}-${month}-${day}`;
  }

  private isSilentDay(preference: NotificationPreference, now: Date) {
    const silentDays = new Set(this.jsonNumberArray(preference.silentDays));
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: preference.timezone,
      weekday: "short"
    }).format(now);
    const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      weekday
    );

    return silentDays.has(index);
  }

  private isDateKeySilent(dateKey: string, silentDays: number[]) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Set(silentDays).has(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
  }

  private buildDedupeKey(input: {
    userId: string;
    goalId: string | null;
    channel: string;
    type: string;
    now: Date;
    timezone: string;
  }) {
    return [
      input.userId,
      input.goalId ?? "account",
      input.channel,
      input.type,
      this.toDateKey(input.now, input.timezone)
    ].join(":");
  }

  private addDateKeyDays(dateKey: string, days: number) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  }

  private zonedDateTimeToUtc(dateKey: string, time: string, timezone: string) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const desiredUtcShape = Date.UTC(year, month - 1, day, hour, minute);
    let guess = desiredUtcShape;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).formatToParts(new Date(guess));
      const value = (type: string) => Number(
        parts.find((part) => part.type === type)?.value ?? 0
      );
      const renderedUtcShape = Date.UTC(
        value("year"),
        value("month") - 1,
        value("day"),
        value("hour"),
        value("minute")
      );
      guess += desiredUtcShape - renderedUtcShape;
    }

    return new Date(guess);
  }
}

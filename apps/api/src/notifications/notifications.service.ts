import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { EmailLog, NotificationPreference, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

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

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    const scheduledFor = this.getNextScheduledAt(preference.reminderTime);
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

    return {
      log: this.serializeEmailLog(log)
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

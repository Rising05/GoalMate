import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "./password.service";
import { SessionTokenService } from "./session-token.service";

interface AuthPayload {
  email: string;
  password: string;
  displayName?: string;
}

const EXPORT_SCOPES = [
  "profile",
  "membership",
  "goals",
  "plans",
  "milestones",
  "dailyTasks",
  "checkins",
  "aiScores",
  "scoreAppeals",
  "deviationEvents",
  "healthSnapshots",
  "rewardCards",
  "failureReports",
  "aiJobs",
  "notificationPreference",
  "emailLogs",
  "wechatBinding",
  "adminProfile",
  "auditLogs"
] as const;

const EXPORT_FORMATS = ["JSON", "CSV", "PDF", "EXCEL"] as const;

type ExportScope = (typeof EXPORT_SCOPES)[number];
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const ACTIVE_GOAL_STATUSES = ["ACTIVE", "AT_RISK", "REPLANNING"] as const;
const FREE_ACTIVE_GOAL_LIMIT = 1;
const PRO_ACTIVE_GOAL_LIMIT = 5;
const FREE_DAILY_AI_JOB_LIMIT = 20;
const PRO_DAILY_AI_JOB_LIMIT = 200;
const FREE_WEEKLY_REPLAN_LIMIT = 3;
const PRO_WEEKLY_REPLAN_LIMIT = 20;
const FREE_WEEKLY_APPEAL_LIMIT = 3;
const PRO_WEEKLY_APPEAL_LIMIT = 30;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(PasswordService)
    private readonly passwordService: PasswordService,
    @Inject(SessionTokenService)
    private readonly sessionTokenService: SessionTokenService
  ) {}

  async register(input: unknown) {
    const payload = this.parseAuthPayload(input, true);
    const existing = await this.prisma.user.findUnique({
      where: { email: payload.email }
    });

    if (existing) {
      throw new BadRequestException("该邮箱已注册");
    }

    const passwordHash = this.passwordService.hash(payload.password);
    const user = await this.prisma.user.create({
      data: {
        email: payload.email,
        passwordHash,
        displayName: payload.displayName,
        membership: {
          create: {
            plan: "FREE",
            status: "ACTIVE"
          }
        }
      },
      include: {
        membership: true,
        adminProfile: true
      }
    });

    return this.buildAuthResponse(user);
  }

  async login(input: unknown) {
    const payload = this.parseAuthPayload(input, false);
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
      include: { membership: true, adminProfile: true }
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("邮箱或密码不正确");
    }

    const passwordMatches = this.passwordService.verify(
      payload.password,
      user.passwordHash
    );

    if (!passwordMatches) {
      throw new UnauthorizedException("邮箱或密码不正确");
    }

    return this.buildAuthResponse(user);
  }

  async getCurrentUser(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    const session = this.sessionTokenService.verify(token);
    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      include: { membership: true, adminProfile: true }
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("登录状态已失效");
    }

    return {
      user: await this.sanitizeUser(user)
    };
  }

  async deleteCurrentUser(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    const session = this.sessionTokenService.verify(token);
    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        id: true,
        status: true
      }
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("登录状态已失效");
    }

    await this.prisma.user.delete({
      where: { id: user.id }
    });

    return {
      deletedUserId: user.id
    };
  }

  async exportCurrentUserData(authorization: string | undefined, input: unknown) {
    const token = this.extractBearerToken(authorization);
    const session = this.sessionTokenService.verify(token);
    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("登录状态已失效");
    }

    const request = this.parseExportPayload(input);
    const scopes = request.fullExport ? [...EXPORT_SCOPES] : request.scopes;
    const base = {
      exportId: `export-${user.id}-${Date.now()}`,
      userId: user.id,
      exportedAt: new Date().toISOString(),
      format: request.format,
      status: request.format === "JSON" ? "READY" : "RESERVED",
      fullExport: request.fullExport,
      scopes
    };

    if (request.format !== "JSON") {
      return {
        ...base,
        data: null,
        download: null,
        message: `${request.format} 导出格式已预留，当前可使用 JSON 完整备份。`
      };
    }

    return {
      ...base,
      data: await this.buildExportData(user.id, scopes),
      message: "JSON 数据导出已生成。"
    };
  }

  private async buildExportData(userId: string, scopes: ExportScope[]) {
    const scopeSet = new Set(scopes);
    const data: Record<string, unknown> = {};
    const goalIds = await this.getExportGoalIds(userId);

    if (scopeSet.has("profile")) {
      data.profile = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          createdAt: true,
          updatedAt: true
        }
      });
    }

    if (scopeSet.has("membership")) {
      data.membership = await this.prisma.membership.findUnique({
        where: { userId }
      });
    }

    if (scopeSet.has("goals")) {
      data.goals = await this.prisma.goal.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("plans")) {
      data.plans = await this.prisma.plan.findMany({
        where: { goalId: { in: goalIds } },
        include: {
          weeklyPlans: {
            orderBy: { weekIndex: "asc" }
          }
        },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("milestones")) {
      data.milestones = await this.prisma.milestone.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: { targetDate: "asc" }
      });
    }

    if (scopeSet.has("dailyTasks")) {
      data.dailyTasks = await this.prisma.dailyTask.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: [{ taskDate: "asc" }, { createdAt: "asc" }]
      });
    }

    if (scopeSet.has("checkins")) {
      data.checkins = await this.prisma.checkin.findMany({
        where: { userId },
        orderBy: { submittedAt: "asc" }
      });
    }

    if (scopeSet.has("aiScores")) {
      data.aiScores = await this.prisma.aiScore.findMany({
        where: {
          checkin: {
            userId
          }
        },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("scoreAppeals")) {
      data.scoreAppeals = await this.prisma.scoreAppeal.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("deviationEvents")) {
      data.deviationEvents = await this.prisma.deviationEvent.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: { detectedAt: "asc" }
      });
    }

    if (scopeSet.has("healthSnapshots")) {
      data.healthSnapshots = await this.prisma.healthSnapshot.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: { date: "asc" }
      });
    }

    if (scopeSet.has("rewardCards")) {
      data.rewardCards = await this.prisma.rewardCard.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: [{ goalId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
      });
    }

    if (scopeSet.has("failureReports")) {
      data.failureReports = await this.prisma.failureReport.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("aiJobs")) {
      data.aiJobs = await this.prisma.aiJob.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("notificationPreference")) {
      data.notificationPreference =
        await this.prisma.notificationPreference.findUnique({
          where: { userId }
        });
    }

    if (scopeSet.has("emailLogs")) {
      data.emailLogs = await this.prisma.emailLog.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("wechatBinding")) {
      data.wechatBinding = await this.prisma.wechatBinding.findUnique({
        where: { userId }
      });
    }

    if (scopeSet.has("adminProfile")) {
      data.adminProfile = await this.prisma.adminUser.findUnique({
        where: { userId }
      });
    }

    if (scopeSet.has("auditLogs")) {
      data.auditLogs = await this.prisma.auditLog.findMany({
        where: { actorUserId: userId },
        orderBy: { createdAt: "asc" }
      });
    }

    return this.serializeExportValue(data);
  }

  private async buildAuthResponse(user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    createdAt: Date;
    membership: {
      plan: string;
      status: string;
      expiresAt: Date | null;
    } | null;
    adminProfile?: {
      role: string;
      status: string;
    } | null;
  }) {
    const token = this.sessionTokenService.sign({
      sub: user.id,
      email: user.email
    });

    return {
      token,
      user: await this.sanitizeUser(user)
    };
  }

  private async sanitizeUser(user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    createdAt: Date;
    membership: {
      plan: string;
      status: string;
      expiresAt: Date | null;
    } | null;
    adminProfile?: {
      role: string;
      status: string;
    } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      membership: user.membership
        ? {
            plan: user.membership.plan,
            status: user.membership.status,
            expiresAt: user.membership.expiresAt?.toISOString() ?? null
          }
        : null,
      adminRole:
        user.adminProfile?.status === "ACTIVE" ? user.adminProfile.role : null,
      quota: await this.getQuotaSummary(user.id, user.membership)
    };
  }

  private async getQuotaSummary(
    userId: string,
    membership: {
      plan: string;
      status: string;
      expiresAt: Date | null;
    } | null
  ) {
    const hasProAccess =
      membership?.plan === "PRO" &&
      ["ACTIVE", "MANUAL"].includes(membership.status) &&
      (!membership.expiresAt || membership.expiresAt > new Date());
    const now = new Date();
    const todayStart = this.getDateRange(this.toDateKey(now)).start;
    const weekStart = new Date(todayStart);
    weekStart.setUTCDate(todayStart.getUTCDate() - 6);
    const [activeGoalCount, aiJobsToday, replansThisWeek, appealsThisWeek] =
      await Promise.all([
        this.prisma.goal.count({
          where: {
            userId,
            status: {
              in: [...ACTIVE_GOAL_STATUSES]
            }
          }
        }),
        this.prisma.aiJob.count({
          where: {
            userId,
            createdAt: {
              gte: todayStart
            }
          }
        }),
        this.prisma.aiJob.count({
          where: {
            userId,
            type: "GOAL_PLAN_REPLAN",
            createdAt: {
              gte: weekStart
            }
          }
        }),
        this.prisma.scoreAppeal.count({
          where: {
            userId,
            createdAt: {
              gte: weekStart
            }
          }
        })
      ]);

    return {
      plan: hasProAccess ? "PRO" : "FREE",
      hasProAccess,
      activeGoals: {
        used: activeGoalCount,
        limit: hasProAccess ? PRO_ACTIVE_GOAL_LIMIT : FREE_ACTIVE_GOAL_LIMIT
      },
      aiJobsToday: {
        used: aiJobsToday,
        limit: hasProAccess ? PRO_DAILY_AI_JOB_LIMIT : FREE_DAILY_AI_JOB_LIMIT
      },
      replansThisWeek: {
        used: replansThisWeek,
        limit: hasProAccess ? PRO_WEEKLY_REPLAN_LIMIT : FREE_WEEKLY_REPLAN_LIMIT
      },
      scoreAppealsThisWeek: {
        used: appealsThisWeek,
        limit: hasProAccess ? PRO_WEEKLY_APPEAL_LIMIT : FREE_WEEKLY_APPEAL_LIMIT
      }
    };
  }

  private getDateRange(dateKey: string) {
    const start = new Date(`${dateKey}T00:00:00.000+08:00`);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    return { start, end };
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

  private parseExportPayload(input: unknown): {
    format: ExportFormat;
    fullExport: boolean;
    scopes: ExportScope[];
  } {
    const body =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const rawFormat =
      typeof body.format === "string" ? body.format.trim().toUpperCase() : "JSON";
    const format = EXPORT_FORMATS.includes(rawFormat as ExportFormat)
      ? (rawFormat as ExportFormat)
      : null;

    if (!format) {
      throw new BadRequestException("导出格式仅支持 JSON、CSV、PDF 或 EXCEL");
    }

    const fullExport = body.fullExport !== false;
    const rawScopes = Array.isArray(body.scopes) ? body.scopes : [];
    const scopes = rawScopes
      .filter((scope): scope is ExportScope =>
        typeof scope === "string" && EXPORT_SCOPES.includes(scope as ExportScope)
      )
      .filter((scope, index, list) => list.indexOf(scope) === index);

    if (!fullExport && scopes.length === 0) {
      throw new BadRequestException("请选择至少一个导出范围");
    }

    return {
      format,
      fullExport,
      scopes
    };
  }

  private async getExportGoalIds(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      select: { id: true }
    });

    return goals.map((goal) => goal.id);
  }

  private serializeExportValue(value: unknown): unknown {
    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeExportValue(item));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        this.serializeExportValue(nestedValue)
      ])
    );
  }

  private parseAuthPayload(input: unknown, allowDisplayName: boolean): AuthPayload {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const email = this.normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const displayName =
      allowDisplayName && typeof body.displayName === "string"
        ? body.displayName.trim().slice(0, 40)
        : undefined;

    if (!email) {
      throw new BadRequestException("请输入有效邮箱");
    }

    if (password.length < 8) {
      throw new BadRequestException("密码至少需要 8 位");
    }

    return {
      email,
      password,
      displayName: displayName || undefined
    };
  }

  private normalizeEmail(value: unknown) {
    if (typeof value !== "string") {
      return "";
    }

    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  }

  private extractBearerToken(authorization?: string) {
    const [scheme, token] = authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("请先登录");
    }

    return token;
  }
}

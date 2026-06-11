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
        membership: true
      }
    });

    return this.buildAuthResponse(user);
  }

  async login(input: unknown) {
    const payload = this.parseAuthPayload(input, false);
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
      include: { membership: true }
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
      include: { membership: true }
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

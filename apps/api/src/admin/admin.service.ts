import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  AiJob,
  AuditLog,
  EmailLog,
  Goal,
  Membership,
  MembershipPlan,
  MembershipStatus,
  Prisma,
  SystemConfig,
  User
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

type AdminRole = "OPERATOR" | "SUPER_ADMIN";

const MEMBERSHIP_PLANS = new Set<MembershipPlan>(["FREE", "PRO"]);
const MEMBERSHIP_STATUSES = new Set<MembershipStatus>([
  "ACTIVE",
  "EXPIRED",
  "MANUAL"
]);

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(QueueService)
    private readonly queueService?: QueueService
  ) {}

  async getOverview(actorUserId: string) {
    const admin = await this.assertAdmin(actorUserId);
    const [
      userCount,
      activeGoalCount,
      atRiskGoalCount,
      failedAiJobCount,
      pendingAiJobCount,
      proMembershipCount,
      queuedEmailCount,
      recentAuditLogs
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.goal.count({
        where: { status: { in: ["ACTIVE", "AT_RISK", "REPLANNING"] } }
      }),
      this.prisma.goal.count({ where: { status: "AT_RISK" } }),
      this.prisma.aiJob.count({ where: { status: "FAILED" } }),
      this.prisma.aiJob.count({
        where: { status: { in: ["QUEUED", "RUNNING", "RETRYING"] } }
      }),
      this.prisma.membership.count({
        where: { plan: "PRO", status: { in: ["ACTIVE", "MANUAL"] } }
      }),
      this.prisma.emailLog.count({ where: { status: "QUEUED" } }),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { actor: { select: { email: true, displayName: true } } }
      })
    ]);

    return {
      admin: {
        role: admin.role,
        status: admin.status
      },
      metrics: {
        users: userCount,
        activeGoals: activeGoalCount,
        atRiskGoals: atRiskGoalCount,
        failedAiJobs: failedAiJobCount,
        pendingAiJobs: pendingAiJobCount,
        proMemberships: proMembershipCount,
        queuedEmails: queuedEmailCount
      },
      recentAuditLogs: recentAuditLogs.map((log) =>
        this.serializeAuditLog(log, log.actor)
      )
    };
  }

  async listUsers(actorUserId: string) {
    await this.assertAdmin(actorUserId);
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        membership: true,
        adminProfile: true,
        _count: {
          select: {
            goals: true,
            aiJobs: true,
            emailLogs: true
          }
        }
      }
    });

    return {
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        membership: user.membership
          ? this.serializeMembership(user.membership)
          : null,
        adminRole: user.adminProfile?.role ?? null,
        counts: {
          goals: user._count.goals,
          aiJobs: user._count.aiJobs,
          emailLogs: user._count.emailLogs
        }
      }))
    };
  }

  async listGoals(actorUserId: string) {
    await this.assertAdmin(actorUserId);
    const goals = await this.prisma.goal.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        user: { select: { email: true, displayName: true } },
        _count: {
          select: {
            dailyTasks: true,
            checkins: true,
            deviationEvents: true,
            rewardCards: true
          }
        }
      }
    });

    return {
      goals: goals.map((goal) => this.serializeAdminGoal(goal))
    };
  }

  async listAiJobs(actorUserId: string) {
    await this.assertAdmin(actorUserId);
    const jobs = await this.prisma.aiJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: { select: { email: true, displayName: true } },
        goal: { select: { title: true, status: true } }
      }
    });

    return {
      jobs: jobs.map((job) => this.serializeAiJob(job))
    };
  }

  async retryAiJob(actorUserId: string, jobId: string, input: unknown) {
    await this.assertAdmin(actorUserId);
    const job = await this.prisma.aiJob.findUnique({
      where: { id: jobId },
      include: {
        user: { select: { email: true, displayName: true } },
        goal: { select: { title: true, status: true } }
      }
    });

    if (!job) {
      throw new NotFoundException("AI 任务不存在");
    }

    if (job.status !== "FAILED") {
      throw new BadRequestException("只有失败的 AI 任务可以重试");
    }

    const payload = this.parseAdminRetryPayload(input);
    const queue = await this.enqueueAiJobRetry(job);
    const originalPayload = this.jsonObject(job.payload);
    const retryMetadata = {
      requestedBy: actorUserId,
      requestedAt: new Date().toISOString(),
      reason: payload.reason,
      previousStatus: job.status,
      previousAttempts: job.attempts,
      previousError: job.error,
      queue
    };
    const retriedJob = await this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        attempts: 0,
        error: null,
        payload: this.toJson({
          ...originalPayload,
          adminRetry: retryMetadata
        })
      },
      include: {
        user: { select: { email: true, displayName: true } },
        goal: { select: { title: true, status: true } }
      }
    });

    await this.createAuditLog(actorUserId, {
      action: "AI_JOB_RETRY",
      targetType: "AI_JOB",
      targetId: job.id,
      reason: payload.reason,
      metadata: {
        userId: job.userId,
        goalId: job.goalId,
        type: job.type,
        previousAttempts: job.attempts,
        previousError: job.error,
        queue
      }
    });

    return {
      job: this.serializeAiJob(retriedJob),
      queue
    };
  }

  async listEmailLogs(actorUserId: string) {
    await this.assertAdmin(actorUserId);
    const logs = await this.prisma.emailLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        user: { select: { email: true, displayName: true } }
      }
    });

    return {
      logs: logs.map((log) => this.serializeEmailLog(log, log.user))
    };
  }

  async updateMembership(
    actorUserId: string,
    targetUserId: string,
    input: unknown
  ) {
    await this.assertAdmin(actorUserId);
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true }
    });

    if (!targetUser) {
      throw new NotFoundException("用户不存在");
    }

    const payload = this.parseMembershipPayload(input);
    const membership = await this.prisma.membership.upsert({
      where: { userId: targetUserId },
      create: {
        userId: targetUserId,
        plan: payload.plan,
        status: payload.status,
        expiresAt: payload.expiresAt
      },
      update: {
        plan: payload.plan,
        status: payload.status,
        expiresAt: payload.expiresAt
      }
    });

    await this.createAuditLog(actorUserId, {
      action: "MEMBERSHIP_UPDATE",
      targetType: "USER",
      targetId: targetUserId,
      reason: payload.reason ?? "后台手动调整会员",
      metadata: {
        targetEmail: targetUser.email,
        plan: membership.plan,
        status: membership.status,
        expiresAt: membership.expiresAt?.toISOString() ?? null
      }
    });

    return {
      membership: this.serializeMembership(membership)
    };
  }

  async getRawUserContent(
    actorUserId: string,
    targetUserId: string,
    reason?: string
  ) {
    await this.assertAdmin(actorUserId, "SUPER_ADMIN");
    const auditReason = typeof reason === "string" ? reason.trim() : "";

    if (auditReason.length < 6) {
      throw new BadRequestException("查看敏感原文必须填写至少 6 个字符的原因");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        goals: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            checkins: {
              orderBy: { submittedAt: "desc" },
              take: 20,
              include: {
                aiScore: true,
                dailyTask: { select: { title: true } }
              }
            },
            rewardCards: {
              orderBy: { sortOrder: "asc" },
              take: 20
            },
            deviationEvents: {
              orderBy: { detectedAt: "desc" },
              take: 20
            }
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundException("用户不存在");
    }

    await this.createAuditLog(actorUserId, {
      action: "RAW_USER_CONTENT_VIEW",
      targetType: "USER",
      targetId: targetUserId,
      reason: auditReason,
      metadata: {
        targetEmail: user.email,
        goalCount: user.goals.length
      }
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: user.status,
        createdAt: user.createdAt.toISOString()
      },
      goals: user.goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        description: goal.description,
        currentBaseline: goal.currentBaseline,
        constraints: goal.constraints,
        finalReward: goal.finalReward,
        status: goal.status,
        createdAt: goal.createdAt.toISOString(),
        checkins: goal.checkins.map((checkin) => ({
          id: checkin.id,
          taskTitle: checkin.dailyTask?.title ?? null,
          content: checkin.content,
          investedMinutes: checkin.investedMinutes,
          completedSubtasks: checkin.completedSubtasks,
          actualQuestionCount: checkin.actualQuestionCount,
          correctQuestionCount: checkin.correctQuestionCount,
          accuracy: checkin.accuracy,
          evidenceFiles: checkin.evidenceFiles,
          evidenceLinks: checkin.evidenceLinks,
          studyMood: checkin.studyMood,
          difficultyLevel: checkin.difficultyLevel,
          submittedAt: checkin.submittedAt.toISOString(),
          aiScore: checkin.aiScore
            ? {
                totalScore: checkin.aiScore.totalScore,
                summary: checkin.aiScore.summary,
                suggestion: checkin.aiScore.suggestion,
                evidence: checkin.aiScore.evidence
              }
            : null
        })),
        rewardCards: goal.rewardCards.map((card) => ({
          id: card.id,
          title: card.title,
          description: card.description,
          cardType: card.cardType,
          sourceType: card.sourceType,
          imageUrl: card.imageUrl,
          linkUrl: card.linkUrl
        })),
        deviationEvents: goal.deviationEvents.map((event) => ({
          id: event.id,
          riskLevel: event.riskLevel,
          primaryReasonCode: event.primaryReasonCode,
          primaryReasonLabel: event.primaryReasonLabel,
          primaryReasonDetail: event.primaryReasonDetail,
          reasons: event.reasons,
          metrics: event.metrics,
          detectedAt: event.detectedAt.toISOString()
        }))
      }))
    };
  }

  async listAuditLogs(actorUserId: string) {
    await this.assertAdmin(actorUserId);
    const logs = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        actor: { select: { email: true, displayName: true } }
      }
    });

    return {
      logs: logs.map((log) => this.serializeAuditLog(log, log.actor))
    };
  }

  async listSystemConfigs(actorUserId: string) {
    await this.assertAdmin(actorUserId);
    const configs = await this.prisma.systemConfig.findMany({
      orderBy: { key: "asc" }
    });

    return {
      configs: configs.map((config) => this.serializeSystemConfig(config))
    };
  }

  async upsertSystemConfig(actorUserId: string, input: unknown) {
    await this.assertAdmin(actorUserId, "SUPER_ADMIN");
    const payload = this.parseSystemConfigPayload(input);
    const config = await this.prisma.systemConfig.upsert({
      where: { key: payload.key },
      create: {
        key: payload.key,
        value: payload.value,
        description: payload.description
      },
      update: {
        value: payload.value,
        description: payload.description
      }
    });

    await this.createAuditLog(actorUserId, {
      action: "SYSTEM_CONFIG_UPSERT",
      targetType: "SYSTEM_CONFIG",
      targetId: config.key,
      reason: payload.reason ?? "后台更新系统配置",
      metadata: {
        key: config.key,
        description: config.description
      }
    });

    return {
      config: this.serializeSystemConfig(config)
    };
  }

  private async assertAdmin(actorUserId: string, requiredRole?: AdminRole) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { userId: actorUserId }
    });

    if (!admin || admin.status !== "ACTIVE") {
      throw new ForbiddenException("无后台访问权限");
    }

    if (requiredRole === "SUPER_ADMIN" && admin.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("需要超级管理员权限");
    }

    return admin;
  }

  private parseMembershipPayload(input: unknown) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const plan = this.parseMembershipPlan(body.plan);
    const status = this.parseMembershipStatus(body.status);
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : null;

    return {
      plan,
      status,
      expiresAt: this.parseOptionalDate(body.expiresAt),
      reason
    };
  }

  private parseMembershipPlan(value: unknown) {
    const plan = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!MEMBERSHIP_PLANS.has(plan as MembershipPlan)) {
      throw new BadRequestException("会员计划必须是 FREE 或 PRO");
    }

    return plan as MembershipPlan;
  }

  private parseMembershipStatus(value: unknown) {
    const status = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!MEMBERSHIP_STATUSES.has(status as MembershipStatus)) {
      throw new BadRequestException("会员状态不正确");
    }

    return status as MembershipStatus;
  }

  private parseOptionalDate(value: unknown) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadRequestException("到期时间必须是 ISO 字符串");
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("到期时间格式不正确");
    }

    return date;
  }

  private parseSystemConfigPayload(input: unknown) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const key = typeof body.key === "string" ? body.key.trim() : "";

    if (!/^[a-z][a-z0-9_.-]{1,80}$/i.test(key)) {
      throw new BadRequestException("配置键名格式不正确");
    }

    if (!("value" in body)) {
      throw new BadRequestException("配置值不能为空");
    }

    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 500)
        : null;
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : null;

    return {
      key,
      value: body.value as Prisma.InputJsonValue,
      description,
      reason
    };
  }

  private parseAdminRetryPayload(input: unknown) {
    const body =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : "";

    if (reason.length < 6) {
      throw new BadRequestException("重试 AI 任务必须填写至少 6 个字符的原因");
    }

    return { reason };
  }

  private async enqueueAiJobRetry(job: AiJob) {
    try {
      const queue = await this.queueService?.enqueueAiJob({
        jobId: job.id,
        type: job.type,
        goalId: job.goalId,
        userId: job.userId
      });

      return queue ?? {
        queued: false,
        queueName: "ai-jobs",
        reason: "Queue service is not configured."
      };
    } catch (error) {
      return {
        queued: false,
        queueName: "ai-jobs",
        error: error instanceof Error ? error.message : "Queue enqueue failed"
      };
    }
  }

  private jsonObject(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private async createAuditLog(
    actorUserId: string,
    input: {
      action: string;
      targetType: string;
      targetId?: string | null;
      reason?: string | null;
      metadata: Prisma.InputJsonValue;
    }
  ) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        reason: input.reason ?? null,
        metadata: input.metadata
      }
    });
  }

  private serializeMembership(membership: Membership) {
    return {
      id: membership.id,
      userId: membership.userId,
      plan: membership.plan,
      status: membership.status,
      expiresAt: membership.expiresAt?.toISOString() ?? null,
      createdAt: membership.createdAt.toISOString(),
      updatedAt: membership.updatedAt.toISOString()
    };
  }

  private serializeAdminGoal(
    goal: Goal & {
      user: Pick<User, "email" | "displayName">;
      _count: {
        dailyTasks: number;
        checkins: number;
        deviationEvents: number;
        rewardCards: number;
      };
    }
  ) {
    return {
      id: goal.id,
      userId: goal.userId,
      userEmail: goal.user.email,
      userDisplayName: goal.user.displayName,
      title: goal.title,
      category: goal.category,
      status: goal.status,
      startDate: goal.startDate.toISOString(),
      endDate: goal.endDate.toISOString(),
      toleranceDaysAllowed: goal.toleranceDaysAllowed,
      toleranceDaysUsed: goal.toleranceDaysUsed,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
      counts: goal._count
    };
  }

  private serializeAiJob(
    job: AiJob & {
      user: Pick<User, "email" | "displayName">;
      goal: Pick<Goal, "title" | "status"> | null;
    }
  ) {
    return {
      id: job.id,
      userId: job.userId,
      userEmail: job.user.email,
      userDisplayName: job.user.displayName,
      goalId: job.goalId,
      goalTitle: job.goal?.title ?? null,
      goalStatus: job.goal?.status ?? null,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    };
  }

  private serializeEmailLog(
    log: EmailLog,
    user?: Pick<User, "email" | "displayName">
  ) {
    return {
      id: log.id,
      userId: log.userId,
      userEmail: user?.email ?? log.recipientEmail,
      userDisplayName: user?.displayName ?? null,
      goalId: log.goalId,
      type: log.type,
      recipientEmail: log.recipientEmail,
      subject: log.subject,
      status: log.status,
      attempts: log.attempts,
      error: log.error,
      scheduledFor: log.scheduledFor?.toISOString() ?? null,
      sentAt: log.sentAt?.toISOString() ?? null,
      createdAt: log.createdAt.toISOString(),
      updatedAt: log.updatedAt.toISOString()
    };
  }

  private serializeAuditLog(
    log: AuditLog,
    actor?: Pick<User, "email" | "displayName">
  ) {
    return {
      id: log.id,
      actorUserId: log.actorUserId,
      actorEmail: actor?.email ?? null,
      actorDisplayName: actor?.displayName ?? null,
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      reason: log.reason,
      metadata: log.metadata,
      createdAt: log.createdAt.toISOString()
    };
  }

  private serializeSystemConfig(config: SystemConfig) {
    return {
      id: config.id,
      key: config.key,
      value: config.value,
      description: config.description,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString()
    };
  }
}

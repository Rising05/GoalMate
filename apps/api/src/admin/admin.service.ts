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
  AiJobStatus,
  AuditLog,
  EmailLog,
  Goal,
  GoalCategory,
  GoalStatus,
  Membership,
  MembershipPlan,
  MembershipStatus,
  Prisma,
  SystemConfig,
  User,
  UserStatus
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
const USER_STATUSES = new Set<UserStatus>(["ACTIVE", "DISABLED", "DELETED"]);
const ADMIN_ROLES = new Set<AdminRole>(["OPERATOR", "SUPER_ADMIN"]);
const GOAL_STATUSES = new Set<GoalStatus>([
  "DRAFT",
  "GENERATING_PLAN",
  "WAITING_CONFIRMATION",
  "ACTIVE",
  "AT_RISK",
  "REPLANNING",
  "COMPLETED",
  "FAILED",
  "GENERATION_FAILED"
]);
const GOAL_CATEGORIES = new Set<GoalCategory>([
  "STUDY",
  "CAREER",
  "FITNESS",
  "HABIT",
  "CUSTOM",
  "POSTGRAD_EXAM",
  "CET_4_6",
  "IELTS_TOEFL",
  "GPA_IMPROVEMENT",
  "CERTIFICATION",
  "CUSTOM_STUDY"
]);
const AI_JOB_STATUSES = new Set<AiJobStatus>([
  "QUEUED",
  "RUNNING",
  "RETRYING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED"
]);
const EMAIL_LOG_STATUSES = new Set(["QUEUED", "SENT", "FAILED"]);
const NOTIFICATION_CHANNELS = new Set(["EMAIL", "WECHAT", "WEB"]);

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

  async listUsers(actorUserId: string, input: unknown = {}) {
    await this.assertAdmin(actorUserId);
    const filters = this.parseUserSearchFilters(input);
    const pagination = this.parsePagination(input);
    const where: Prisma.UserWhereInput = {
      ...(filters.query
        ? {
            OR: [
              {
                email: {
                  contains: filters.query
                }
              },
              {
                displayName: {
                  contains: filters.query
                }
              }
            ]
          }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.plan
        ? {
            membership: {
              is: {
                plan: filters.plan
              }
            }
          }
        : {}),
      ...(filters.adminRole
        ? {
            adminProfile: {
              is: {
                role: filters.adminRole,
                status: "ACTIVE"
              }
            }
          }
        : {})
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize,
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
      }),
      this.prisma.user.count({ where })
    ]);

    return {
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      filters,
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

  async listGoals(actorUserId: string, input: unknown = {}) {
    await this.assertAdmin(actorUserId);
    const filters = this.parseGoalFilters(input);
    const pagination = this.parsePagination(input);
    const where: Prisma.GoalWhereInput = {
      ...(filters.query
        ? {
            OR: [
              { title: { contains: filters.query } },
              { description: { contains: filters.query } },
              { user: { email: { contains: filters.query } } },
              { user: { displayName: { contains: filters.query } } }
            ]
          }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.category ? { category: filters.category } : {})
    };
    const [goals, total] = await Promise.all([
      this.prisma.goal.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          _count: {
            select: {
              dailyTasks: true,
              checkins: true,
              deviationEvents: true,
              rewardCards: true
            }
          }
        }
      }),
      this.prisma.goal.count({ where })
    ]);
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [...new Set(goals.map((goal) => goal.userId))]
        }
      },
      select: { id: true, email: true, displayName: true }
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    return {
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      filters,
      goals: goals.map((goal) =>
        this.serializeAdminGoal(goal, usersById.get(goal.userId))
      )
    };
  }

  async listAiJobs(actorUserId: string, input: unknown = {}) {
    await this.assertAdmin(actorUserId);
    const filters = this.parseAiJobFilters(input);
    const pagination = this.parsePagination(input);
    const where: Prisma.AiJobWhereInput = {
      ...(filters.query
        ? {
            OR: [
              { type: { contains: filters.query } },
              { user: { email: { contains: filters.query } } },
              { user: { displayName: { contains: filters.query } } },
              { goal: { title: { contains: filters.query } } }
            ]
          }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {})
    };
    const [jobs, total] = await Promise.all([
      this.prisma.aiJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          user: { select: { email: true, displayName: true } },
          goal: { select: { title: true, status: true } }
        }
      }),
      this.prisma.aiJob.count({ where })
    ]);

    return {
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      filters,
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

  async listEmailLogs(actorUserId: string, input: unknown = {}) {
    await this.assertAdmin(actorUserId);
    const filters = this.parseEmailLogFilters(input);
    const pagination = this.parsePagination(input);
    const where: Prisma.EmailLogWhereInput = {
      ...(filters.query
        ? {
            OR: [
              { recipientEmail: { contains: filters.query } },
              { subject: { contains: filters.query } },
              { type: { contains: filters.query } },
              { user: { email: { contains: filters.query } } },
              { user: { displayName: { contains: filters.query } } }
            ]
          }
        : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.channel ? { channel: filters.channel } : {})
    };
    const [logs, total] = await Promise.all([
      this.prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize,
        include: {
          user: { select: { email: true, displayName: true } }
        }
      }),
      this.prisma.emailLog.count({ where })
    ]);

    return {
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      filters,
      logs: logs.map((log) => this.serializeEmailLog(log, log.user))
    };
  }

  async listUploadAssets(actorUserId: string, input: unknown = {}) {
    await this.assertAdmin(actorUserId);
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const pagination = this.parsePagination(input);
    const query = this.cleanOptionalFilterText(body.query);
    const status = this.cleanOptionalFilterText(body.status)?.toUpperCase();
    const where: Prisma.UploadAssetWhereInput = {
      ...(query ? { OR: [
        { fileName: { contains: query } },
        { mimeType: { contains: query } },
        { user: { email: { contains: query } } }
      ] } : {}),
      ...(status ? { status } : {})
    };
    const [assets, total] = await Promise.all([
      this.prisma.uploadAsset.findMany({
        where, skip: pagination.skip, take: pagination.pageSize,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true, displayName: true } } }
      }),
      this.prisma.uploadAsset.count({ where })
    ]);
    return {
      total, page: pagination.page, pageSize: pagination.pageSize,
      assets: assets.map((asset) => ({
        id: asset.id, userId: asset.userId, userEmail: asset.user.email,
        fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes,
        source: asset.source, purpose: asset.purpose, status: asset.status,
        scanStatus: asset.scanStatus, storageProvider: asset.storageProvider,
        createdAt: asset.createdAt.toISOString()
      }))
    };
  }

  async listPaymentEvents(actorUserId: string, input: unknown = {}) {
    await this.assertAdmin(actorUserId);
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const pagination = this.parsePagination(input);
    const provider = this.cleanOptionalFilterText(body.provider)?.toUpperCase();
    const type = this.cleanOptionalFilterText(body.type);
    const where: Prisma.PaymentEventWhereInput = {
      ...(provider ? { provider } : {}), ...(type ? { type: { contains: type } } : {})
    };
    const [events, total] = await Promise.all([
      this.prisma.paymentEvent.findMany({
        where, skip: pagination.skip, take: pagination.pageSize,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true } }, order: { select: { status: true, amountCents: true, currency: true } } }
      }),
      this.prisma.paymentEvent.count({ where })
    ]);
    return {
      total, page: pagination.page, pageSize: pagination.pageSize,
      events: events.map((event) => ({
        id: event.id, orderId: event.orderId, userEmail: event.user.email,
        provider: event.provider, providerEventId: event.providerEventId,
        type: event.type, orderStatus: event.order?.status ?? null,
        amountCents: event.order?.amountCents ?? null, currency: event.order?.currency ?? null,
        processedAt: event.processedAt?.toISOString() ?? null,
        createdAt: event.createdAt.toISOString()
      }))
    };
  }

  async listMembershipAudits(actorUserId: string, input: unknown = {}) {
    await this.assertAdmin(actorUserId);
    const pagination = this.parsePagination(input);
    const audits = await this.prisma.membershipAudit.findMany({
      skip: pagination.skip, take: pagination.pageSize, orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } }, actor: { select: { email: true } } }
    });
    const total = await this.prisma.membershipAudit.count();
    return {
      total, page: pagination.page, pageSize: pagination.pageSize,
      audits: audits.map((audit) => ({
        id: audit.id, userEmail: audit.user.email, actorEmail: audit.actor?.email ?? null,
        action: audit.action, fromPlan: audit.fromPlan, toPlan: audit.toPlan,
        fromStatus: audit.fromStatus, toStatus: audit.toStatus,
        expiresAt: audit.expiresAt?.toISOString() ?? null, reason: audit.reason,
        createdAt: audit.createdAt.toISOString()
      }))
    };
  }

  async retryEmailLog(actorUserId: string, logId: string, input: unknown) {
    await this.assertAdmin(actorUserId);
    const payload = this.parseAdminRetryPayload(input);
    const log = await this.prisma.emailLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException("提醒日志不存在");
    if (log.status !== "FAILED" || log.attempts >= 3) {
      throw new BadRequestException("只有未耗尽重试次数的失败提醒可以重试");
    }
    const updated = await this.prisma.emailLog.update({
      where: { id: log.id },
      data: { status: "QUEUED", error: null, errorCode: null, scheduledFor: new Date() }
    });
    const queue = await this.queueService?.enqueueEmailLog({
      emailLogId: updated.id, userId: updated.userId, type: updated.type
    });
    await this.createAuditLog(actorUserId, {
      action: "NOTIFICATION_RETRY", targetType: "EMAIL_LOG", targetId: log.id,
      reason: payload.reason, metadata: { channel: log.channel, attempts: log.attempts, queue: queue ?? null }
    });
    return { log: this.serializeEmailLog(updated), queue: queue ?? null };
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
    const previousMembership = await this.prisma.membership.findUnique({
      where: { userId: targetUserId }
    });
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
    await this.prisma.membershipAudit.create({
      data: {
        userId: targetUserId,
        actorUserId,
        action: "ADMIN_UPDATE",
        fromPlan: previousMembership?.plan ?? null,
        toPlan: membership.plan,
        fromStatus: previousMembership?.status ?? null,
        toStatus: membership.status,
        expiresAt: membership.expiresAt,
        reason: payload.reason ?? "后台手动调整会员",
        metadata: { targetEmail: targetUser.email }
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

  private parseUserSearchFilters(input: unknown) {
    const body =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim().slice(0, 80)
        : undefined;
    const status = this.parseOptionalUserStatus(body.status);
    const plan = this.parseOptionalMembershipPlan(body.plan);
    const adminRole = this.parseOptionalAdminRole(body.adminRole);

    return {
      query,
      status,
      plan,
      adminRole
    };
  }

  private parsePagination(input: unknown) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const page = Math.max(1, Number.isInteger(Number(body.page)) ? Number(body.page) : 1);
    const pageSize = Math.min(100, Math.max(1, Number.isInteger(Number(body.pageSize)) ? Number(body.pageSize) : 20));
    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private parseOptionalUserStatus(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const status = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!USER_STATUSES.has(status as UserStatus)) {
      throw new BadRequestException("用户状态不正确");
    }

    return status as UserStatus;
  }

  private parseOptionalMembershipPlan(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const plan = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!MEMBERSHIP_PLANS.has(plan as MembershipPlan)) {
      throw new BadRequestException("会员计划必须是 FREE 或 PRO");
    }

    return plan as MembershipPlan;
  }

  private parseOptionalAdminRole(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const role = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!ADMIN_ROLES.has(role as AdminRole)) {
      throw new BadRequestException("后台角色不正确");
    }

    return role as AdminRole;
  }

  private parseGoalFilters(input: unknown) {
    const body =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};

    return {
      query: this.cleanOptionalFilterText(body.query),
      status: this.parseOptionalGoalStatus(body.status),
      category: this.parseOptionalGoalCategory(body.category)
    };
  }

  private parseAiJobFilters(input: unknown) {
    const body =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};

    return {
      query: this.cleanOptionalFilterText(body.query),
      status: this.parseOptionalAiJobStatus(body.status),
      type: this.cleanOptionalFilterText(body.type)
    };
  }

  private parseEmailLogFilters(input: unknown) {
    const body =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};

    return {
      query: this.cleanOptionalFilterText(body.query),
      status: this.parseOptionalEmailLogStatus(body.status),
      type: this.cleanOptionalFilterText(body.type),
      channel: this.parseOptionalNotificationChannel(body.channel)
    };
  }

  private parseOptionalGoalStatus(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const status = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!GOAL_STATUSES.has(status as GoalStatus)) {
      throw new BadRequestException("目标状态不正确");
    }

    return status as GoalStatus;
  }

  private parseOptionalGoalCategory(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const category = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!GOAL_CATEGORIES.has(category as GoalCategory)) {
      throw new BadRequestException("目标分类不正确");
    }

    return category as GoalCategory;
  }

  private parseOptionalAiJobStatus(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const status = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!AI_JOB_STATUSES.has(status as AiJobStatus)) {
      throw new BadRequestException("AI 任务状态不正确");
    }

    return status as AiJobStatus;
  }

  private parseOptionalEmailLogStatus(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const status = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!EMAIL_LOG_STATUSES.has(status)) {
      throw new BadRequestException("提醒日志状态不正确");
    }

    return status;
  }

  private parseOptionalNotificationChannel(value: unknown) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const channel = typeof value === "string" ? value.trim().toUpperCase() : "";

    if (!NOTIFICATION_CHANNELS.has(channel)) {
      throw new BadRequestException("提醒渠道不正确");
    }

    return channel;
  }

  private cleanOptionalFilterText(value: unknown) {
    return typeof value === "string" && value.trim()
      ? value.trim().slice(0, 80)
      : undefined;
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
      _count: {
        dailyTasks: number;
        checkins: number;
        deviationEvents: number;
        rewardCards: number;
      };
    },
    user?: Pick<User, "email" | "displayName">
  ) {
    return {
      id: goal.id,
      userId: goal.userId,
      userEmail: user?.email ?? "用户已删除",
      userDisplayName: user?.displayName ?? null,
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
      channel: log.channel,
      type: log.type,
      recipientEmail: log.recipientEmail,
      subject: log.subject,
      status: log.status,
      attempts: log.attempts,
      provider: log.provider,
      providerMessageId: log.providerMessageId,
      errorCode: log.errorCode,
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

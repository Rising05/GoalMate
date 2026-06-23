import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "./password.service";
import { SessionTokenService } from "./session-token.service";
import { QuotaService } from "../quota/quota.service";
import { ObjectDeletionService } from "../object-lifecycle/object-deletion.service";
import { FieldEncryptionService } from "../security/field-encryption.service";

interface AuthPayload {
  email: string;
  password: string;
  displayName?: string;
}

const CURRENT_TERMS_VERSION = "terms-2026-06-23";
const CURRENT_PRIVACY_VERSION = "privacy-2026-06-23";
const CURRENT_AI_DISCLOSURE_VERSION = "ai-disclosure-2026-06-23";

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
  "reportArtifacts",
  "rewardCards",
  "failureReports",
  "aiJobs",
  "notificationPreference",
  "emailLogs",
  "wechatBinding",
  "uploadAssets",
  "paymentOrders",
  "subscriptions",
  "payments",
  "paymentEvents",
  "membershipAudits",
  "entitlements",
  "usageRecords",
  "adminProfile",
  "auditLogs"
] as const;

const EXPORT_FORMATS = ["JSON", "CSV", "PDF", "EXCEL"] as const;

type ExportScope = (typeof EXPORT_SCOPES)[number];
type ExportFormat = (typeof EXPORT_FORMATS)[number];

const ACTIVE_GOAL_STATUSES = ["ACTIVE", "AT_RISK", "REPLANNING"] as const;
const FREE_ACTIVE_GOAL_LIMIT = 1;
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
    private readonly sessionTokenService: SessionTokenService,
    @Optional()
    @Inject(ObjectDeletionService)
    private readonly objectDeletions: ObjectDeletionService = new ObjectDeletionService(prisma),
    @Optional()
    @Inject(QuotaService)
    private readonly quotaService: QuotaService = new QuotaService(prisma),
    @Optional()
    @Inject(FieldEncryptionService)
    private readonly fields: FieldEncryptionService = new FieldEncryptionService()
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
    const acceptedAt = new Date();
    const user = await this.prisma.user.create({
      data: {
        email: payload.email,
        passwordHash,
        displayName: payload.displayName,
        termsVersion: CURRENT_TERMS_VERSION,
        termsAcceptedAt: acceptedAt,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        privacyAcceptedAt: acceptedAt,
        aiDisclosureVersion: CURRENT_AI_DISCLOSURE_VERSION,
        aiDisclosureAcceptedAt: acceptedAt,
        requiresTermsAcceptance: false,
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

    const assets = await this.prisma.uploadAsset.findMany({
      where: { userId: user.id },
      select: { objectKey: true, storageProvider: true }
    });
    await this.prisma.$transaction(async (tx) => {
      await this.objectDeletions.scheduleWithClient(tx, assets, "ACCOUNT_DELETION");
      await tx.user.delete({ where: { id: user.id } });
    });

    return {
      deletedUserId: user.id,
      objectDeletionsScheduled: assets.length
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
      status: "READY",
      fullExport: request.fullExport,
      scopes
    };

    if (request.format === "EXCEL") {
      const data = await this.buildExportData(user.id, scopes);
      const content = this.buildExcelExport(data);

      return {
        ...base,
        data: null,
        download: {
          filename: `${base.exportId}.xls`,
          contentType: "application/vnd.ms-excel; charset=utf-8",
          encoding: "utf-8",
          content
        },
        message: "EXCEL 数据导出已生成。"
      };
    }

    if (request.format === "PDF") {
      const data = await this.buildExportData(user.id, scopes);
      const content = this.buildPdfExport(data, {
        exportId: base.exportId,
        exportedAt: base.exportedAt,
        scopes
      });

      return {
        ...base,
        data: null,
        download: {
          filename: `${base.exportId}.pdf`,
          contentType: "application/pdf",
          encoding: "base64",
          content
        },
        message: "PDF 数据报告已生成。"
      };
    }

    if (request.format === "CSV") {
      const data = await this.buildExportData(user.id, scopes);
      const content = this.buildCsvExport(data);

      return {
        ...base,
        data: null,
        download: {
          filename: `${base.exportId}.csv`,
          contentType: "text/csv; charset=utf-8",
          encoding: "utf-8",
          content
        },
        message: "CSV 数据导出已生成。"
      };
    }

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
      download: null,
      message: "JSON 数据导出已生成。"
    };
  }

  private async buildExportData(
    userId: string,
    scopes: ExportScope[]
  ): Promise<Record<string, unknown>> {
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
          termsVersion: true,
          termsAcceptedAt: true,
          privacyVersion: true,
          privacyAcceptedAt: true,
          aiDisclosureVersion: true,
          aiDisclosureAcceptedAt: true,
          requiresTermsAcceptance: true,
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
      const goals = await this.prisma.goal.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
      data.goals = goals.map((goal) => this.exportGoal(goal));
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
      const checkins = await this.prisma.checkin.findMany({
        where: { userId },
        orderBy: { submittedAt: "asc" }
      });
      data.checkins = checkins.map((checkin) => this.exportCheckin(checkin));
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
      const appeals = await this.prisma.scoreAppeal.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
      data.scoreAppeals = appeals.map((appeal) => this.exportScoreAppeal(appeal));
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

    if (scopeSet.has("reportArtifacts")) {
      data.reportArtifacts = await this.prisma.reportArtifact.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("rewardCards")) {
      const rewardCards = await this.prisma.rewardCard.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: [{ goalId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }]
      });
      data.rewardCards = rewardCards.map((card) => this.exportRewardCard(card));
    }

    if (scopeSet.has("failureReports")) {
      const failureReports = await this.prisma.failureReport.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: { createdAt: "asc" }
      });
      data.failureReports = failureReports.map((report) => this.exportFailureReport(report));
    }

    if (scopeSet.has("aiJobs")) {
      const aiJobs = await this.prisma.aiJob.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
      data.aiJobs = aiJobs.map((job) => this.exportAiJob(job));
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
      const binding = await this.prisma.wechatBinding.findUnique({
        where: { userId }
      });
      data.wechatBinding = binding ? this.exportWechatBinding(binding) : null;
    }

    if (scopeSet.has("uploadAssets")) {
      data.uploadAssets = await this.prisma.uploadAsset.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("paymentOrders")) {
      data.paymentOrders = await this.prisma.paymentOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("subscriptions")) {
      data.subscriptions = await this.prisma.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("payments")) {
      data.payments = await this.prisma.paymentTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("paymentEvents")) {
      data.paymentEvents = await this.prisma.paymentEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("membershipAudits")) {
      const audits = await this.prisma.membershipAudit.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
      data.membershipAudits = audits.map((audit) => this.exportMembershipAudit(audit));
    }

    if (scopeSet.has("entitlements")) {
      data.entitlements = await this.prisma.entitlement.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("usageRecords")) {
      data.usageRecords = await this.prisma.usageRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" }
      });
    }

    if (scopeSet.has("adminProfile")) {
      data.adminProfile = await this.prisma.adminUser.findUnique({
        where: { userId }
      });
    }

    if (scopeSet.has("auditLogs")) {
      const auditLogs = await this.prisma.auditLog.findMany({
        where: { actorUserId: userId },
        orderBy: { createdAt: "asc" }
      });
      data.auditLogs = auditLogs.map((audit) => this.exportAuditLog(audit));
    }

    return this.serializeExportValue(data) as Record<string, unknown>;
  }

  private async buildAuthResponse(user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    createdAt: Date;
    termsVersion?: string | null;
    termsAcceptedAt?: Date | null;
    privacyVersion?: string | null;
    privacyAcceptedAt?: Date | null;
    aiDisclosureVersion?: string | null;
    aiDisclosureAcceptedAt?: Date | null;
    requiresTermsAcceptance?: boolean;
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
    termsVersion?: string | null;
    termsAcceptedAt?: Date | null;
    privacyVersion?: string | null;
    privacyAcceptedAt?: Date | null;
    aiDisclosureVersion?: string | null;
    aiDisclosureAcceptedAt?: Date | null;
    requiresTermsAcceptance?: boolean;
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
      legalConsent: {
        termsVersion: user.termsVersion ?? null,
        termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
        privacyVersion: user.privacyVersion ?? null,
        privacyAcceptedAt: user.privacyAcceptedAt?.toISOString() ?? null,
        aiDisclosureVersion: user.aiDisclosureVersion ?? null,
        aiDisclosureAcceptedAt: user.aiDisclosureAcceptedAt?.toISOString() ?? null,
        requiresTermsAcceptance: user.requiresTermsAcceptance ?? false,
        currentTermsVersion: CURRENT_TERMS_VERSION,
        currentPrivacyVersion: CURRENT_PRIVACY_VERSION,
        currentAiDisclosureVersion: CURRENT_AI_DISCLOSURE_VERSION
      },
      quota: await this.getQuotaSummary(user.id, user.membership)
    };
  }

  private async getQuotaSummary(
    userId: string,
    _membership: {
      plan: string;
      status: string;
      expiresAt: Date | null;
    } | null
  ) {
    const [hasProAccess, activeGoalCount, capabilities] = await Promise.all([
      this.quotaService.hasProAccess(userId),
      this.prisma.goal.count({
        where: {
          userId,
          status: { in: [...ACTIVE_GOAL_STATUSES] }
        }
      }),
      this.quotaService.getSummary(userId)
    ]);

    return {
      plan: hasProAccess ? "PRO" : "FREE",
      hasProAccess,
      activeGoals: {
        used: activeGoalCount,
        limit: capabilities.ACTIVE_GOAL.limit,
        resetAt: capabilities.ACTIVE_GOAL.resetAt,
        period: capabilities.ACTIVE_GOAL.period
      },
      aiJobsToday: capabilities.CHECKIN_SCORING,
      replansThisWeek: capabilities.GOAL_REPLAN,
      scoreAppealsThisWeek: capabilities.SCORE_APPEAL,
      planGenerationsThisMonth: capabilities.PLAN_GENERATION,
      reportsThisMonth: capabilities.REPORT_GENERATION,
      rewardCards: capabilities.REWARD_CARD,
      uploadStorageBytes: {
        used: capabilities.UPLOAD_STORAGE_KIB.used * 1024,
        limit: capabilities.UPLOAD_STORAGE_KIB.limit === null
          ? null
          : capabilities.UPLOAD_STORAGE_KIB.limit * 1024,
        resetAt: capabilities.UPLOAD_STORAGE_KIB.resetAt,
        period: capabilities.UPLOAD_STORAGE_KIB.period
      },
      capabilities
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

  private buildCsvExport(data: Record<string, unknown>) {
    const rows: string[][] = [["scope", "recordIndex", "field", "value"]];

    for (const [scope, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        value.forEach((record, index) => {
          this.appendCsvRecordRows(rows, scope, index, record);
        });
        continue;
      }

      this.appendCsvRecordRows(rows, scope, 0, value);
    }

    return rows.map((row) => row.map((cell) => this.escapeCsvCell(cell)).join(",")).join("\n");
  }

  private appendCsvRecordRows(
    rows: string[][],
    scope: string,
    recordIndex: number,
    record: unknown
  ) {
    if (record && typeof record === "object" && !Array.isArray(record)) {
      for (const [field, value] of Object.entries(record as Record<string, unknown>)) {
        rows.push([scope, String(recordIndex), field, this.stringifyCsvValue(value)]);
      }
      return;
    }

    rows.push([scope, String(recordIndex), "value", this.stringifyCsvValue(record)]);
  }

  private stringifyCsvValue(value: unknown) {
    if (value === null || value === undefined) {
      return "";
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private escapeCsvCell(value: string) {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  private buildExcelExport(data: Record<string, unknown>) {
    const rows: string[][] = [["scope", "recordIndex", "field", "value"]];

    for (const [scope, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        value.forEach((record, index) => {
          this.appendCsvRecordRows(rows, scope, index, record);
        });
        continue;
      }

      this.appendCsvRecordRows(rows, scope, 0, value);
    }

    const tableRows = rows
      .map(
        (row) =>
          `<Row>${row
            .map(
              (cell) =>
                `<Cell><Data ss:Type="String">${this.escapeXmlCell(cell)}</Data></Cell>`
            )
            .join("")}</Row>`
      )
      .join("");

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="GoalMate Export">',
      `<Table>${tableRows}</Table>`,
      "</Worksheet>",
      "</Workbook>"
    ].join("");
  }

  private escapeXmlCell(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  private buildPdfExport(
    data: Record<string, unknown>,
    metadata: { exportId: string; exportedAt: string; scopes: ExportScope[] }
  ) {
    const lines = [
      "GoalMate Account Export",
      `Export ID: ${metadata.exportId}`,
      `Exported At: ${metadata.exportedAt}`,
      `Scopes: ${metadata.scopes.join(", ")}`,
      ""
    ];

    for (const [scope, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        lines.push(`${scope}: ${value.length} records`);
        value.slice(0, 4).forEach((record, index) => {
          lines.push(`  ${index + 1}. ${this.toPdfSummary(record)}`);
        });
        continue;
      }

      lines.push(`${scope}: ${this.toPdfSummary(value)}`);
    }

    const escapedLines = lines
      .flatMap((line) => this.wrapPdfLine(this.toAsciiPdfText(line), 92))
      .slice(0, 60);
    const stream = [
      "BT",
      "/F1 10 Tf",
      "50 750 Td",
      "14 TL",
      ...escapedLines.map((line) => `(${this.escapePdfText(line)}) Tj T*`),
      "ET"
    ].join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`
    ];
    const chunks = ["%PDF-1.4\n"];
    const offsets = [0];

    for (const [index, object] of objects.entries()) {
      offsets.push(Buffer.byteLength(chunks.join(""), "utf8"));
      chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
    }

    const xrefOffset = Buffer.byteLength(chunks.join(""), "utf8");
    chunks.push(`xref\n0 ${objects.length + 1}\n`);
    chunks.push("0000000000 65535 f \n");
    offsets.slice(1).forEach((offset) => {
      chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
    });
    chunks.push(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    );

    return Buffer.from(chunks.join(""), "utf8").toString("base64");
  }

  private toPdfSummary(value: unknown) {
    if (!value || typeof value !== "object") {
      return this.stringifyCsvValue(value);
    }

    const record = value as Record<string, unknown>;
    const preferredKeys = ["title", "email", "displayName", "status", "type", "subject"];
    const parts = preferredKeys
      .filter((key) => key in record)
      .map((key) => `${key}=${this.stringifyCsvValue(record[key])}`);

    return parts.length ? parts.join("; ") : JSON.stringify(record).slice(0, 180);
  }

  private toAsciiPdfText(value: string) {
    return value.replace(/[^\x20-\x7E]/g, (character) => {
      const codePoint = character.codePointAt(0)?.toString(16).toUpperCase() ?? "FFFD";
      return `\\u${codePoint.padStart(4, "0")}`;
    });
  }

  private wrapPdfLine(value: string, size: number) {
    if (value.length <= size) {
      return [value];
    }

    const lines: string[] = [];

    for (let index = 0; index < value.length; index += size) {
      lines.push(value.slice(index, index + size));
    }

    return lines;
  }

  private escapePdfText(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
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

  private exportGoal(goal: Record<string, unknown> & {
    description: string;
    currentBaseline: string | null;
    constraints: string | null;
    finalReward: string | null;
  }) {
    const {
      descriptionKeyVersion,
      currentBaselineKeyVersion,
      constraintsKeyVersion,
      finalRewardKeyVersion,
      ...rest
    } = goal;

    return {
      ...rest,
      description: this.fields.decrypt(goal.description),
      currentBaseline: this.fields.decryptNullable(goal.currentBaseline),
      constraints: this.fields.decryptNullable(goal.constraints),
      finalReward: this.fields.decryptNullable(goal.finalReward)
    };
  }

  private exportCheckin(checkin: Record<string, unknown> & {
    content: string;
    studyMood: string | null;
    difficultyLevel: string | null;
  }) {
    const {
      contentKeyVersion,
      studyMoodKeyVersion,
      difficultyLevelKeyVersion,
      ...rest
    } = checkin;

    return {
      ...rest,
      content: this.fields.decrypt(checkin.content),
      studyMood: this.fields.decryptNullable(checkin.studyMood),
      difficultyLevel: this.fields.decryptNullable(checkin.difficultyLevel)
    };
  }

  private exportScoreAppeal(appeal: Record<string, unknown> & {
    reason: string;
    addedFacts: string;
  }) {
    const { reasonKeyVersion, addedFactsKeyVersion, ...rest } = appeal;

    return {
      ...rest,
      reason: this.fields.decrypt(appeal.reason),
      addedFacts: this.fields.decrypt(appeal.addedFacts)
    };
  }

  private exportRewardCard(card: Record<string, unknown> & {
    description: string | null;
  }) {
    const { descriptionKeyVersion, ...rest } = card;

    return {
      ...rest,
      description: this.fields.decryptNullable(card.description)
    };
  }

  private exportFailureReport(report: Record<string, unknown> & {
    reasonAnalysis: string;
    suggestion: string;
  }) {
    const { reasonAnalysisKeyVersion, suggestionKeyVersion, ...rest } = report;

    return {
      ...rest,
      reasonAnalysis: this.fields.decrypt(report.reasonAnalysis),
      suggestion: this.fields.decrypt(report.suggestion)
    };
  }

  private exportWechatBinding(binding: Record<string, unknown> & {
    openId: string;
    unionId: string | null;
  }) {
    const {
      openIdHash,
      unionIdHash,
      openIdKeyVersion,
      unionIdKeyVersion,
      ...rest
    } = binding;

    return {
      ...rest,
      openId: this.fields.decrypt(binding.openId),
      unionId: this.fields.decryptNullable(binding.unionId)
    };
  }

  private exportAiJob(job: Record<string, unknown> & { payload: unknown; result: unknown }) {
    return {
      ...job,
      payload: this.redactAiJobPayload(job.payload),
      result: this.redactAiJobPayload(job.result)
    };
  }

  private redactAiJobPayload(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactAiJobPayload(item));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const sensitiveKeys = new Set([
      "description",
      "constraints",
      "currentBaseline",
      "finalReward",
      "adjustmentReason",
      "content",
      "reason",
      "addedFacts"
    ]);

    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sensitiveKeys.has(key) ? "[REDACTED]" : this.redactAiJobPayload(nestedValue)
      ])
    );
  }

  private exportAuditLog(log: Record<string, unknown> & { reason: string | null }) {
    const { reasonKeyVersion, ...rest } = log;

    return {
      ...rest,
      reason: this.fields.decryptNullable(log.reason)
    };
  }

  private exportMembershipAudit(log: Record<string, unknown> & { reason: string | null }) {
    const { reasonKeyVersion, ...rest } = log;

    return {
      ...rest,
      reason: this.fields.decryptNullable(log.reason)
    };
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

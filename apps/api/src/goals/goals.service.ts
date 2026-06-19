import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  AiJob,
  AiScore,
  Checkin,
  DailyTask,
  DeviationEvent,
  FailureReport,
  Goal,
  GoalCategory,
  GoalStatus,
  HealthSnapshot,
  Prisma,
  ReportArtifact
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { STORAGE_PROVIDER, StorageProvider } from "../uploads/storage-provider";
import { MockReportNarrativeProvider } from "./mock-report-narrative.provider";
import {
  REPORT_NARRATIVE_PROVIDER,
  ReportNarrativeInput,
  ReportNarrativeProvider
} from "./report-narrative.provider";
import { QuotaService } from "../quota/quota.service";

interface CreateGoalPayload {
  title: string;
  description: string;
  category: GoalCategory;
  startDate: Date;
  endDate: Date;
  dailyTimeBudgetMinutes?: number;
  examName?: string;
  targetScore?: string;
  currentScore?: string;
  examDate?: Date;
  subjects?: string[];
  materials?: string[];
  chapters?: string[];
  weaknesses?: string[];
  studyDaysPerWeek?: number;
  dailyStudyMinutes?: number;
  mockExamFrequency?: string;
  toleranceDaysAllowed: number;
  currentBaseline?: string;
  constraints?: string;
  finalReward?: string;
}

interface RestartGoalPayload {
  title?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  dailyTimeBudgetMinutes?: number;
  toleranceDaysAllowed?: number;
}

const CATEGORY_MAP: Record<string, GoalCategory> = {
  study: "STUDY",
  career: "CAREER",
  fitness: "FITNESS",
  habit: "HABIT",
  custom: "CUSTOM",
  postgrad_exam: "POSTGRAD_EXAM",
  postgrad: "POSTGRAD_EXAM",
  cet_4_6: "CET_4_6",
  cet: "CET_4_6",
  ielts_toefl: "IELTS_TOEFL",
  ielts: "IELTS_TOEFL",
  toefl: "IELTS_TOEFL",
  gpa_improvement: "GPA_IMPROVEMENT",
  gpa: "GPA_IMPROVEMENT",
  certification: "CERTIFICATION",
  custom_study: "CUSTOM_STUDY"
};

const DONE_STATUS = "DONE";
const RESCUE_TASK_TYPE = "RESCUE";
const RESCUE_TASK_GENERATION = "RESCUE_TASK_GENERATION";
const FAILURE_REPORT_GENERATION = "FAILURE_REPORT_GENERATION";
const PENDING_STATUS = "PENDING";
const SETTLEABLE_GOAL_STATUSES: GoalStatus[] = ["ACTIVE", "AT_RISK", "REPLANNING"];
const REPORT_TYPES = ["HEALTH_SNAPSHOT", "WEEKLY_TREND", "MONTHLY_TREND"] as const;

type HealthTask = DailyTask & {
  checkins: Array<Checkin & { aiScore: AiScore | null }>;
};

type GoalSettlementTask = DailyTask & {
  checkins: Array<Checkin & { aiScore: AiScore | null }>;
};

type GoalFailureReport = FailureReport & {
  goal: Goal;
};

type DeviationRiskLevel = "stable" | "warning" | "danger";
type ReportType = typeof REPORT_TYPES[number];

interface HealthTrendReportData {
  type: "WEEKLY_TREND" | "MONTHLY_TREND";
  goalId: string;
  goalTitle: string;
  range: {
    startsOn: string;
    endsOn: string;
    days: number;
  };
  snapshotCount: number;
  averageHealthScore: number | null;
  previousAverageHealthScore: number | null;
  scoreDelta: number | null;
  trendDirection: "up" | "down" | "flat" | "no_data";
  minHealthScore: number | null;
  maxHealthScore: number | null;
  latestSnapshot: unknown;
  riskCounts: {
    stable: number;
    warning: number;
    danger: number;
  };
  dominantRiskLevel: "stable" | "warning" | "danger" | "no_data";
  insights: string[];
  generatedAt: string;
}

type DeviationReasonCode =
  | "LOW_SCORE"
  | "LOW_INVESTMENT"
  | "BROKEN_STREAK"
  | "TASK_DELAY";

interface DeviationReason {
  code: DeviationReasonCode;
  level: Exclude<DeviationRiskLevel, "stable">;
  label: string;
  detail: string;
}

interface DeviationSignal {
  eventId?: string | null;
  detectedAt?: string | null;
  riskLevel: DeviationRiskLevel;
  reasons: DeviationReason[];
  metrics: {
    averageScore: number | null;
    recentInvestedMinutes: number;
    expectedRecentMinutes: number;
    streakDays: number;
    overdueTaskCount: number;
    incompleteTodayTaskCount: number;
  };
}

interface HealthCompletionMetrics {
  todayCompletionRate: number;
  weekCompletionRate: number;
  recentNormalTaskCount: number;
  recentNormalTaskCompletedCount: number;
  recentNormalTaskCompletionRate: number;
  recentRescueTaskCount: number;
  recentRescueTaskCompletedCount: number;
  recentRescueTaskCompletionRate: number;
  taskTypeWeights: {
    normal: number;
    rescue: number;
  };
}

interface HealthRescueMetrics {
  recentRescueSuccessCount: number;
  rescueTaskCompletionRate: number;
  rescueNextDayRecovered: boolean | null;
  nextDayNormalTaskCompletionRate: number | null;
  lastCompletedRescueTaskId: string | null;
}

interface RescueTaskGenerationContext {
  goal: Goal;
  todayStart: Date;
  todayEnd: Date;
  deviation: DeviationSignal;
  sourceTask: DailyTask | null;
  existingRescueTask: DailyTask | null;
  deviationEvent: DeviationEvent | null;
}

@Injectable()
export class GoalsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(QueueService)
    private readonly queueService?: QueueService,
    @Optional()
    @Inject(REPORT_NARRATIVE_PROVIDER)
    private readonly reportNarrativeProvider?: ReportNarrativeProvider,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage?: StorageProvider,
    @Optional()
    @Inject(QuotaService)
    private readonly quotaService: QuotaService = new QuotaService(prisma)
  ) {}

  async createGoal(userId: string, input: unknown) {
    const payload = this.parseCreateGoalPayload(input);
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        title: payload.title,
        description: payload.description,
        category: payload.category,
        status: "DRAFT",
        startDate: payload.startDate,
        endDate: payload.endDate,
        dailyTimeBudgetMinutes: payload.dailyTimeBudgetMinutes,
        examName: payload.examName,
        targetScore: payload.targetScore,
        currentScore: payload.currentScore,
        examDate: payload.examDate,
        subjects: payload.subjects ? this.toJson(payload.subjects) : undefined,
        materials: payload.materials ? this.toJson(payload.materials) : undefined,
        chapters: payload.chapters ? this.toJson(payload.chapters) : undefined,
        weaknesses: payload.weaknesses ? this.toJson(payload.weaknesses) : undefined,
        studyDaysPerWeek: payload.studyDaysPerWeek,
        dailyStudyMinutes: payload.dailyStudyMinutes,
        mockExamFrequency: payload.mockExamFrequency,
        toleranceDaysAllowed: payload.toleranceDaysAllowed,
        currentBaseline: payload.currentBaseline,
        constraints: payload.constraints,
        finalReward: payload.finalReward
      }
    });

    return {
      goal: this.serializeGoal(goal)
    };
  }

  async listGoals(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });

    return {
      goals: goals.map((goal) => this.serializeGoal(goal))
    };
  }

  async getGoalById(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    return {
      goal: this.serializeGoal(goal)
    };
  }

  async deleteGoal(userId: string, id: string) {
    const goal = await this.getOwnedGoal(userId, id);
    const assets = await this.prisma.uploadAsset.findMany({
      where: { userId },
      select: { id: true, objectKey: true, storageProvider: true, metadata: true }
    });
    const goalAssets = assets.filter((asset) => {
      const metadata = asset.metadata && typeof asset.metadata === "object" &&
        !Array.isArray(asset.metadata)
        ? asset.metadata as Record<string, unknown>
        : {};
      return metadata.goalId === goal.id;
    });

    if (this.storage) {
      await Promise.all(
        goalAssets
          .filter((asset) => asset.storageProvider === this.storage!.name)
          .map((asset) => this.storage!.delete(asset.objectKey))
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.emailLog.updateMany({
        where: {
          userId,
          goalId: goal.id
        },
        data: {
          goalId: null
        }
      });

      await tx.uploadAsset.deleteMany({
        where: { id: { in: goalAssets.map((asset) => asset.id) } }
      });

      await tx.goal.delete({
        where: {
          id: goal.id
        }
      });
    });

    return {
      deletedGoalId: goal.id
    };
  }

  async getGoalHealth(userId: string, id: string) {
    const context = await this.getGoalHealthContext(userId, id);
    const {
      goal,
      todayTasks,
      weekTasks,
      allTasks,
      recentCheckins,
      todayStart,
      todayEnd,
      recentStart,
      recentEnd
    } = context;
    const todayCompletionRate = this.getCompletionRate(todayTasks);
    const weekCompletionRate = this.getCompletionRate(weekTasks);
    const streakDays = this.getStreakDays(allTasks, todayStart);
    const averageScore = this.getAverageScore(recentCheckins);
    const recentInvestedMinutes = this.getRecentInvestedMinutes(recentCheckins);
    const toleranceRemaining = Math.max(
      0,
      goal.toleranceDaysAllowed - goal.toleranceDaysUsed
    );
    const deviation = this.buildDeviationSignal({
      goal,
      todayTasks,
      allTasks,
      recentCheckins,
      todayStart,
      recentStart,
      recentEnd,
      averageScore,
      recentInvestedMinutes,
      streakDays
    });
    const sourceTask = this.findRescueSourceTask(todayTasks, allTasks, todayStart);
    const deviationEvent = await this.persistDeviationEvent({
      goal,
      deviation,
      sourceTask,
      todayStart,
      todayEnd
    });
    const completionMetrics = this.buildHealthCompletionMetrics({
      todayTasks,
      weekTasks,
      allTasks,
      recentStart,
      recentEnd
    });
    const rescueMetrics = this.buildHealthRescueMetrics({
      allTasks,
      recentStart,
      recentEnd,
      todayStart
    });
    const risks = this.buildHealthRisks({
      todayCompletionRate,
      weekCompletionRate,
      streakDays,
      averageScore,
      toleranceRemaining,
      deviation
    });
    const healthScore = this.getHealthScore({
      todayCompletionRate,
      weekCompletionRate,
      streakDays,
      averageScore,
      toleranceRemaining,
      riskCount: risks.length
    });
    const snapshot = await this.upsertHealthSnapshot({
      goal,
      date: todayStart,
      healthScore,
      deviationEvent,
      completionMetrics,
      rescueMetrics,
      riskLevel: deviation.riskLevel
    });

    return {
      goalId: goal.id,
      goalTitle: goal.title,
      status: goal.status,
      healthScore,
      todayCompletionRate,
      weekCompletionRate,
      streakDays,
      toleranceRemaining,
      averageScore,
      recentInvestedMinutes,
      rescueSuccessCount7d: rescueMetrics.recentRescueSuccessCount,
      rescueTaskCompletionRate: rescueMetrics.rescueTaskCompletionRate,
      normalTaskCompletionRate: completionMetrics.recentNormalTaskCompletionRate,
      rescueNextDayRecovered: rescueMetrics.rescueNextDayRecovered,
      completionMetrics,
      rescueMetrics,
      healthWeights: this.getHealthWeights(),
      snapshot: this.serializeHealthSnapshot(snapshot),
      risks,
      deviation: this.serializeDeviationSignal(deviation, deviationEvent)
    };
  }

  async listHealthSnapshots(userId: string, id: string) {
    const goal = await this.getOwnedGoal(userId, id);
    const snapshots = await this.prisma.healthSnapshot.findMany({
      where: {
        goalId: goal.id
      },
      orderBy: {
        date: "asc"
      },
      take: 120
    });

    return {
      goalId: goal.id,
      snapshots: snapshots.map((snapshot) => this.serializeHealthSnapshot(snapshot))
    };
  }

  async enqueueHealthSnapshotReport(userId: string, id: string, input: unknown = {}) {
    return this.enqueueGoalReport(userId, id, {
      ...this.inputObject(input),
      type: "HEALTH_SNAPSHOT"
    });
  }

  async enqueueGoalReport(userId: string, id: string, input: unknown = {}) {
    const goal = await this.getOwnedGoal(userId, id);
    const body = this.inputObject(input);
    const type = this.parseReportType(body.type ?? "HEALTH_SNAPSHOT");
    const reportDate = this.parseOptionalDateKey(body.reportDate);
    const queue = await this.enqueueReportJob({
      type,
      userId,
      goalId: goal.id,
      reportDate
    });

    return {
      report: {
        type,
        userId,
        goalId: goal.id,
        reportDate
      },
      queue
    };
  }

  async getHealthTrendReport(userId: string, id: string, input: unknown = {}) {
    const goal = await this.getOwnedGoal(userId, id);
    const body = this.inputObject(input);
    const type = this.parseTrendReportType(body.type ?? "WEEKLY_TREND");
    const reportDate = this.parseOptionalDateKey(body.reportDate);

    return this.buildHealthTrendReport({
      goal,
      type,
      reportDate
    });
  }

  async generateGoalReportArtifact(userId: string, id: string, input: unknown = {}) {
    const goal = await this.getOwnedGoal(userId, id);
    const body = this.inputObject(input);
    const type = this.parseTrendReportType(body.type ?? "WEEKLY_TREND");
    const reportDate = this.parseOptionalDateKey(body.reportDate);
    const report = await this.buildHealthTrendReport({ goal, type, reportDate });
    const artifact = await this.quotaService.runWithQuota(
      userId,
      "REPORT_GENERATION",
      {
        idempotencyKey: `report:${goal.id}:${type}:${report.range.endsOn}`,
        resourceType: "REPORT_ARTIFACT",
        resourceId: `${goal.id}:${type}:${report.range.endsOn}`
      },
      (tx) => this.persistHealthTrendArtifact(report, tx)
    );

    return {
      report,
      artifact: this.serializeReportArtifact(artifact)
    };
  }

  async listGoalReportArtifacts(userId: string, id: string) {
    const goal = await this.getOwnedGoal(userId, id);
    const artifacts = await this.prisma.reportArtifact.findMany({
      where: { goalId: goal.id },
      orderBy: { createdAt: "desc" },
      take: 24
    });

    return {
      goalId: goal.id,
      artifacts: artifacts.map((artifact) => this.serializeReportArtifact(artifact))
    };
  }

  async downloadGoalReportArtifact(
    userId: string,
    goalId: string,
    artifactId: string
  ) {
    await this.getOwnedGoal(userId, goalId);
    const artifact = await this.prisma.reportArtifact.findFirst({
      where: {
        id: artifactId,
        goalId
      }
    });

    if (!artifact) {
      throw new NotFoundException("报告文件不存在");
    }

    return {
      artifact: this.serializeReportArtifact(artifact),
      download: {
        filename: `${artifact.type.toLowerCase()}-${this.toDateKey(artifact.periodEnd)}.md`,
        contentType: "text/markdown; charset=utf-8",
        encoding: "utf-8",
        content: artifact.body
      }
    };
  }

  async processQueuedReportJob(input: unknown) {
    const payload = this.parseReportWorkerPayload(input);

    if (payload.type === "HEALTH_SNAPSHOT") {
      const result = await this.getGoalHealth(payload.userId, payload.goalId);

      return {
        processed: true,
        type: payload.type,
        goalId: payload.goalId,
        userId: payload.userId,
        snapshot: result.snapshot,
        healthScore: result.healthScore,
        riskLevel: result.snapshot.riskLevel
      };
    }

    if (payload.type === "WEEKLY_TREND" || payload.type === "MONTHLY_TREND") {
      const goal = await this.getOwnedGoal(payload.userId, payload.goalId);
      const report = await this.buildHealthTrendReport({
        goal,
        type: payload.type,
        reportDate: payload.reportDate
      });
      const artifact = await this.quotaService.runWithQuota(
        payload.userId,
        "REPORT_GENERATION",
        {
          idempotencyKey: `report:${goal.id}:${payload.type}:${report.range.endsOn}`,
          resourceType: "REPORT_ARTIFACT",
          resourceId: `${goal.id}:${payload.type}:${report.range.endsOn}`
        },
        (tx) => this.persistHealthTrendArtifact(report, tx)
      );

      return {
        processed: true,
        type: payload.type,
        goalId: payload.goalId,
        userId: payload.userId,
        report,
        artifact: this.serializeReportArtifact(artifact)
      };
    }

    throw new BadRequestException(`不支持的报告任务类型：${payload.type}`);
  }

  private async buildHealthTrendReport(input: {
    goal: Goal;
    type: Extract<ReportType, "WEEKLY_TREND" | "MONTHLY_TREND">;
    reportDate: string | null;
  }): Promise<HealthTrendReportData> {
    const days = input.type === "WEEKLY_TREND" ? 7 : 30;
    const endDateKey = input.reportDate ?? this.toDateKey(new Date());
    const endDate = this.parseDateKey(endDateKey);
    const rangeEndExclusive = addUtcDays(endDate, 1);
    const rangeStart = addUtcDays(rangeEndExclusive, -days);
    const previousRangeStart = addUtcDays(rangeStart, -days);
    const snapshots = await this.prisma.healthSnapshot.findMany({
      where: {
        goalId: input.goal.id,
        date: {
          gte: rangeStart,
          lt: rangeEndExclusive
        }
      },
      orderBy: {
        date: "asc"
      }
    });
    const previousSnapshots = await this.prisma.healthSnapshot.findMany({
      where: {
        goalId: input.goal.id,
        date: {
          gte: previousRangeStart,
          lt: rangeStart
        }
      },
      orderBy: {
        date: "asc"
      }
    });
    const stats = this.summarizeHealthSnapshots(snapshots);
    const previousStats = this.summarizeHealthSnapshots(previousSnapshots);
    const scoreDelta =
      stats.averageHealthScore !== null && previousStats.averageHealthScore !== null
        ? stats.averageHealthScore - previousStats.averageHealthScore
        : null;
    const trendDirection =
      scoreDelta === null
        ? "no_data"
        : scoreDelta >= 5
          ? "up"
          : scoreDelta <= -5
            ? "down"
            : "flat";

    return {
      type: input.type,
      goalId: input.goal.id,
      goalTitle: input.goal.title,
      range: {
        startsOn: this.toDateKey(rangeStart),
        endsOn: endDateKey,
        days
      },
      snapshotCount: snapshots.length,
      averageHealthScore: stats.averageHealthScore,
      previousAverageHealthScore: previousStats.averageHealthScore,
      scoreDelta,
      trendDirection,
      minHealthScore: stats.minHealthScore,
      maxHealthScore: stats.maxHealthScore,
      latestSnapshot: stats.latestSnapshot,
      riskCounts: stats.riskCounts,
      dominantRiskLevel: stats.dominantRiskLevel,
      insights: this.buildHealthTrendInsights({
        snapshotCount: snapshots.length,
        days,
        trendDirection,
        scoreDelta,
        riskCounts: stats.riskCounts,
        dominantRiskLevel: stats.dominantRiskLevel
      }),
      generatedAt: new Date().toISOString()
    };
  }

  private async persistHealthTrendArtifact(
    report: HealthTrendReportData,
    client: PrismaService | Prisma.TransactionClient = this.prisma
  ) {
    const fallbackProvider = new MockReportNarrativeProvider();
    const selectedProvider = this.reportNarrativeProvider ?? fallbackProvider;
    const narrativeInput: ReportNarrativeInput = {
      type: report.type,
      goalTitle: report.goalTitle,
      startsOn: report.range.startsOn,
      endsOn: report.range.endsOn,
      snapshotCount: report.snapshotCount,
      averageHealthScore: report.averageHealthScore,
      previousAverageHealthScore: report.previousAverageHealthScore,
      scoreDelta: report.scoreDelta,
      trendDirection: report.trendDirection,
      minHealthScore: report.minHealthScore,
      maxHealthScore: report.maxHealthScore,
      dominantRiskLevel: report.dominantRiskLevel,
      riskCounts: report.riskCounts,
      insights: report.insights
    };
    let provider = selectedProvider;
    let providerError: string | null = null;
    let narrative;

    try {
      narrative = await selectedProvider.generate(narrativeInput);
    } catch (error) {
      providerError =
        error instanceof Error ? error.message : "Report narrative provider failed";
      provider = fallbackProvider;
      narrative = fallbackProvider.generate(narrativeInput);
    }

    return client.reportArtifact.upsert({
      where: {
        goalId_type_periodEnd: {
          goalId: report.goalId,
          type: report.type,
          periodEnd: this.parseDateKey(report.range.endsOn)
        }
      },
      create: {
        goalId: report.goalId,
        type: report.type,
        periodStart: this.parseDateKey(report.range.startsOn),
        periodEnd: this.parseDateKey(report.range.endsOn),
        title: narrative.title,
        summary: narrative.summary,
        body: narrative.body,
        recommendations: this.toJson(narrative.recommendations),
        provider: provider.name,
        model: provider.model ?? null,
        promptVersion: "health-trend-narrative-v1",
        status: "READY",
        error: providerError
      },
      update: {
        periodStart: this.parseDateKey(report.range.startsOn),
        title: narrative.title,
        summary: narrative.summary,
        body: narrative.body,
        recommendations: this.toJson(narrative.recommendations),
        provider: provider.name,
        model: provider.model ?? null,
        promptVersion: "health-trend-narrative-v1",
        status: "READY",
        error: providerError
      }
    });
  }

  private summarizeHealthSnapshots(snapshots: HealthSnapshot[]) {
    const riskCounts = snapshots.reduce(
      (counts, snapshot) => {
        if (snapshot.riskLevel === "danger") {
          counts.danger += 1;
        } else if (snapshot.riskLevel === "warning") {
          counts.warning += 1;
        } else {
          counts.stable += 1;
        }

        return counts;
      },
      { stable: 0, warning: 0, danger: 0 }
    );
    const scores = snapshots.map((snapshot) => snapshot.healthScore);
    const averageHealthScore = scores.length
      ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null;
    const dominantRiskLevel: HealthTrendReportData["dominantRiskLevel"] =
      riskCounts.danger >= riskCounts.warning && riskCounts.danger >= riskCounts.stable && riskCounts.danger > 0
        ? "danger"
        : riskCounts.warning >= riskCounts.stable && riskCounts.warning > 0
          ? "warning"
          : riskCounts.stable > 0
            ? "stable"
            : "no_data";

    return {
      averageHealthScore,
      minHealthScore: scores.length ? Math.min(...scores) : null,
      maxHealthScore: scores.length ? Math.max(...scores) : null,
      latestSnapshot: snapshots.length
        ? this.serializeHealthSnapshot(snapshots[snapshots.length - 1])
        : null,
      riskCounts,
      dominantRiskLevel
    };
  }

  private buildHealthTrendInsights(input: {
    snapshotCount: number;
    days: number;
    trendDirection: string;
    scoreDelta: number | null;
    riskCounts: {
      stable: number;
      warning: number;
      danger: number;
    };
    dominantRiskLevel: string;
  }) {
    if (!input.snapshotCount) {
      return ["当前周期还没有健康快照，先完成一次健康报告生成。"];
    }

    const insights = [
      `本周期已有 ${input.snapshotCount}/${input.days} 天健康快照。`
    ];

    if (input.scoreDelta !== null) {
      if (input.trendDirection === "up") {
        insights.push(`平均健康分较上一周期提升 ${input.scoreDelta} 分。`);
      } else if (input.trendDirection === "down") {
        insights.push(`平均健康分较上一周期下降 ${Math.abs(input.scoreDelta)} 分。`);
      } else {
        insights.push("平均健康分较上一周期基本持平。");
      }
    }

    if (input.riskCounts.danger > 0) {
      insights.push(`出现 ${input.riskCounts.danger} 天危险状态，建议优先生成救援任务。`);
    } else if (input.riskCounts.warning > 0) {
      insights.push(`出现 ${input.riskCounts.warning} 天预警状态，建议降低任务粒度。`);
    } else if (input.dominantRiskLevel === "stable") {
      insights.push("本周期风险状态稳定，继续保持当前执行节奏。");
    }

    return insights;
  }

  private parseReportType(value: unknown): ReportType {
    const type = this.cleanText(value, 80).toUpperCase();

    if (!REPORT_TYPES.includes(type as ReportType)) {
      throw new BadRequestException(`不支持的报告任务类型：${type || "EMPTY"}`);
    }

    return type as ReportType;
  }

  private parseTrendReportType(value: unknown): Extract<ReportType, "WEEKLY_TREND" | "MONTHLY_TREND"> {
    const type = this.parseReportType(value);

    if (type !== "WEEKLY_TREND" && type !== "MONTHLY_TREND") {
      throw new BadRequestException("趋势报告仅支持 WEEKLY_TREND 或 MONTHLY_TREND");
    }

    return type;
  }

  private parseOptionalDateKey(value: unknown) {
    const dateKey = this.cleanText(value, 40);

    if (!dateKey) {
      return null;
    }

    this.parseDateKey(dateKey);

    return dateKey;
  }

  private parseDateKey(dateKey: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      throw new BadRequestException("报告日期格式必须为 YYYY-MM-DD");
    }

    const date = new Date(`${dateKey}T00:00:00.000+08:00`);

    if (Number.isNaN(date.getTime()) || this.toDateKey(date) !== dateKey) {
      throw new BadRequestException("报告日期无效");
    }

    return date;
  }

  private inputObject(input: unknown) {
    return input && typeof input === "object"
      ? input as Record<string, unknown>
      : {};
  }

  private parseReportWorkerPayload(input: unknown) {
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const type = this.parseReportType(body.type);
    const userId = this.cleanText(body.userId, 191);
    const goalId = this.cleanText(body.goalId, 191);
    const reportDate = this.parseOptionalDateKey(body.reportDate);

    if (!userId || !goalId) {
      throw new BadRequestException("报告任务缺少用户或目标");
    }

    return {
      type,
      userId,
      goalId,
      reportDate
    };
  }

  private async enqueueReportJob(input: {
    type: ReportType;
    userId: string;
    goalId: string;
    reportDate: string | null;
  }) {
    try {
      return await this.queueService?.enqueueReportJob(input) ?? {
        queued: false,
        queueName: "reports",
        reason: "Queue service is not configured."
      };
    } catch (error) {
      return {
        queued: false,
        queueName: "reports",
        error: error instanceof Error ? error.message : "Queue enqueue failed"
      };
    }
  }

  private async attachAiJobQueueMetadata(job: AiJob) {
    const payload = this.jsonObject(job.payload);

    try {
      const queue = await this.queueService?.enqueueAiJob({
        jobId: job.id,
        type: job.type,
        goalId: job.goalId,
        userId: job.userId
      });

      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          payload: this.toJson({
            ...payload,
            queue: queue ?? {
              queued: false,
              queueName: "ai-jobs",
              reason: "Queue service is not configured."
            }
          })
        }
      });
    } catch (error) {
      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          payload: this.toJson({
            ...payload,
            queue: {
              queued: false,
              queueName: "ai-jobs",
              error: error instanceof Error ? error.message : "Queue enqueue failed"
            }
          })
        }
      });
    }
  }

  private shouldQueueRescueTask() {
    return process.env.RESCUE_TASK_ASYNC === "true";
  }

  async generateRescueTask(userId: string, id: string) {
    const context = await this.getRescueTaskGenerationContext(userId, id);

    if (this.shouldQueueRescueTask()) {
      const job = await this.prisma.aiJob.create({
        data: {
          userId,
          goalId: context.goal.id,
          type: RESCUE_TASK_GENERATION,
          status: "QUEUED",
          payload: {
            goalId: context.goal.id,
            deviationEventId: context.deviationEvent?.id ?? null,
            riskLevel: context.deviation.riskLevel,
            triggerReason: context.deviation.reasons[0]?.label ?? null,
            triggerCode: context.deviation.reasons[0]?.code ?? null,
            provider: "mock-rescue"
          }
        }
      });
      const queuedJob = await this.attachAiJobQueueMetadata(job);

      return {
        goalId: context.goal.id,
        goalTitle: context.goal.title,
        deviation: this.serializeDeviationSignal(
          context.deviation,
          context.deviationEvent
        ),
        rescueTask: null as never,
        job: this.serializeAiJob(queuedJob)
      };
    }

    const result = await this.persistRescueTaskFromContext(context);
    const job = await this.prisma.aiJob.create({
      data: {
        userId,
        goalId: context.goal.id,
        type: RESCUE_TASK_GENERATION,
        status: "SUCCEEDED",
        attempts: 1,
        payload: {
          goalId: context.goal.id,
          deviationEventId: context.deviationEvent?.id ?? null,
          riskLevel: context.deviation.riskLevel,
          triggerReason: context.deviation.reasons[0]?.label ?? null,
          triggerCode: context.deviation.reasons[0]?.code ?? null,
          provider: "mock-rescue",
          mode: "sync-compatible"
        },
        result: {
          rescueTaskId: result.rescueTask.id,
          deviationEventId: result.deviation.eventId,
          riskLevel: result.deviation.riskLevel,
          fallback: false
        }
      }
    });

    return {
      ...result,
      job: this.serializeAiJob(job)
    };
  }

  async processQueuedRescueTaskJob(id: string) {
    const job = await this.prisma.aiJob.findUnique({
      where: { id }
    });

    if (!job) {
      throw new NotFoundException("AI 任务不存在");
    }

    if (job.type !== RESCUE_TASK_GENERATION) {
      throw new BadRequestException(`不支持的救援任务类型：${job.type}`);
    }

    if (job.status !== "QUEUED") {
      return {
        job: this.serializeAiJob(job),
        processed: false,
        reason: "AI job is not queued."
      };
    }

    const payload = this.jsonObject(job.payload);
    const goalId = typeof payload.goalId === "string" ? payload.goalId : job.goalId;

    if (!goalId) {
      const failedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: "Queued rescue task job is missing goalId."
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        processed: true,
        rescueTask: null
      };
    }

    let context: RescueTaskGenerationContext;

    try {
      context = await this.getRescueTaskGenerationContext(job.userId, goalId);
    } catch (error) {
      const failedJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Rescue task context failed"
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        processed: true,
        rescueTask: null
      };
    }

    const runningJob = await this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        attempts: {
          increment: 1
        }
      }
    });
    const providerError =
      payload.simulateProviderFailure === true
        ? "simulated rescue provider failure"
        : null;

    try {
      const result = await this.persistRescueTaskFromContext(context);
      const succeededJob = await this.prisma.aiJob.update({
        where: { id: runningJob.id },
        data: {
          status: "SUCCEEDED",
          result: {
            rescueTaskId: result.rescueTask.id,
            deviationEventId: result.deviation.eventId,
            riskLevel: result.deviation.riskLevel,
            fallback: Boolean(providerError),
            providerError
          },
          error: providerError
        }
      });

      return {
        ...result,
        job: this.serializeAiJob(succeededJob),
        processed: true,
        fallback: Boolean(providerError)
      };
    } catch (error) {
      const failedJob = await this.prisma.aiJob.update({
        where: { id: runningJob.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Rescue task generation failed"
        }
      });

      return {
        job: this.serializeAiJob(failedJob),
        processed: true,
        rescueTask: null
      };
    }
  }

  private async getRescueTaskGenerationContext(
    userId: string,
    id: string
  ): Promise<RescueTaskGenerationContext> {
    const context = await this.getGoalHealthContext(userId, id);
    const {
      goal,
      todayTasks,
      allTasks,
      recentCheckins,
      todayStart,
      recentStart,
      recentEnd
    } = context;

    if (!["ACTIVE", "AT_RISK", "REPLANNING"].includes(goal.status)) {
      throw new BadRequestException("当前目标状态不能生成救援任务");
    }

    const averageScore = this.getAverageScore(recentCheckins);
    const recentInvestedMinutes = this.getRecentInvestedMinutes(recentCheckins);
    const streakDays = this.getStreakDays(allTasks, todayStart);
    const deviation = this.buildDeviationSignal({
      goal,
      todayTasks,
      allTasks,
      recentCheckins,
      todayStart,
      recentStart,
      recentEnd,
      averageScore,
      recentInvestedMinutes,
      streakDays
    });
    const sourceTask = this.findRescueSourceTask(todayTasks, allTasks, todayStart);
    const existingRescueTask = await this.prisma.dailyTask.findFirst({
      where: {
        goalId: goal.id,
        taskType: RESCUE_TASK_TYPE,
        status: PENDING_STATUS,
        taskDate: {
          gte: todayStart,
          lt: context.todayEnd
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    const existingDeviationEvent = existingRescueTask?.deviationEventId
      ? await this.prisma.deviationEvent.findUnique({
          where: { id: existingRescueTask.deviationEventId }
        })
      : null;
    const deviationEvent =
      existingDeviationEvent ??
      (await this.persistDeviationEvent({
        goal,
        deviation,
        sourceTask,
        todayStart,
        todayEnd: context.todayEnd
      }));
    return {
      goal,
      todayStart,
      todayEnd: context.todayEnd,
      deviation,
      sourceTask,
      existingRescueTask,
      deviationEvent
    };
  }

  private async persistRescueTaskFromContext(
    context: RescueTaskGenerationContext
  ) {
    const { goal, todayStart, deviation, sourceTask, existingRescueTask, deviationEvent } =
      context;
    const rescueTaskDraft = this.buildMockRescueTask(goal, deviation);
    const rescueTask = existingRescueTask
      ? existingRescueTask.deviationEventId || !deviationEvent
        ? existingRescueTask
        : await this.prisma.dailyTask.update({
            where: { id: existingRescueTask.id },
            data: { deviationEventId: deviationEvent.id }
          })
      : await this.prisma.dailyTask.create({
        data: {
          goalId: goal.id,
          sourceDailyTaskId: sourceTask?.id,
          deviationEventId: deviationEvent?.id,
          taskDate: todayStart,
          title: rescueTaskDraft.title,
          description: rescueTaskDraft.description,
          plannedMinutes: rescueTaskDraft.estimatedMinutes,
          taskType: RESCUE_TASK_TYPE,
          rescueReason: rescueTaskDraft.reason,
          rescueTriggerCode: rescueTaskDraft.triggerCode,
          rescueRiskLevel: deviation.riskLevel,
          status: PENDING_STATUS
        }
      });

    return {
      goalId: goal.id,
      goalTitle: goal.title,
      deviation: this.serializeDeviationSignal(deviation, deviationEvent),
      rescueTask: this.serializeRescueTask(goal, rescueTask)
    };
  }

  private shouldQueueFailureReport() {
    return process.env.FAILURE_REPORT_ASYNC === "true";
  }

  private async enqueueFailureReportGeneration(
    goal: Goal,
    missedDays: ReturnType<GoalsService["getMissedTaskDays"]>
  ) {
    const existingJob = await this.prisma.aiJob.findFirst({
      where: {
        userId: goal.userId,
        goalId: goal.id,
        type: FAILURE_REPORT_GENERATION,
        status: {
          in: ["QUEUED", "RUNNING", "RETRYING"]
        }
      },
      orderBy: { createdAt: "desc" }
    });

    if (existingJob) {
      return existingJob;
    }

    const job = await this.prisma.aiJob.create({
      data: {
        userId: goal.userId,
        goalId: goal.id,
        type: FAILURE_REPORT_GENERATION,
        status: "QUEUED",
        payload: {
          goalId: goal.id,
          missedDayCount: missedDays.length,
          toleranceDaysAllowed: goal.toleranceDaysAllowed,
          provider: "rule-failure-report",
          promptVersion: "failure-report-v1"
        }
      }
    });

    return this.attachAiJobQueueMetadata(job);
  }

  private async recordSucceededFailureReportJob(
    goal: Goal,
    report: FailureReport,
    missedDays: ReturnType<GoalsService["getMissedTaskDays"]>
  ) {
    const existingJob = await this.prisma.aiJob.findFirst({
      where: {
        userId: goal.userId,
        goalId: goal.id,
        type: FAILURE_REPORT_GENERATION,
        status: "SUCCEEDED"
      },
      orderBy: { createdAt: "desc" }
    });
    const data = {
      status: "SUCCEEDED" as const,
      attempts: 1,
      payload: this.toJson({
        goalId: goal.id,
        missedDayCount: missedDays.length,
        toleranceDaysAllowed: goal.toleranceDaysAllowed,
        provider: "rule-failure-report",
        promptVersion: "failure-report-v1",
        mode: "sync-compatible"
      }),
      result: this.toJson({
        failureReportId: report.id,
        missedDayCount: missedDays.length,
        provider: "rule-failure-report"
      }),
      error: null
    };

    if (existingJob) {
      return this.prisma.aiJob.update({
        where: { id: existingJob.id },
        data
      });
    }

    return this.prisma.aiJob.create({
      data: {
        userId: goal.userId,
        goalId: goal.id,
        type: FAILURE_REPORT_GENERATION,
        ...data
      }
    });
  }

  private async failFailureReportJob(job: AiJob, error: string) {
    const failedJob = await this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error
      }
    });

    return {
      job: this.serializeAiJob(failedJob),
      processed: true,
      failureReport: null
    };
  }

  async settleGoal(userId: string, id: string) {
    const goal = await this.getOwnedGoal(userId, id);
    const tasks = await this.getGoalSettlementTasks(goal.id);
    const missedDays = this.getMissedTaskDays(tasks);
    const toleranceDaysUsed = missedDays.length;
    const todayStart = this.getDateRange(this.toDateKey(new Date())).start;
    const reachedEndDate = todayStart >= this.getDateRange(this.toDateKey(goal.endDate)).start;
    let nextStatus = goal.status;
    let failureReport: FailureReport | null = null;
    let failureReportJob: AiJob | null = null;

    if (SETTLEABLE_GOAL_STATUSES.includes(goal.status as (typeof SETTLEABLE_GOAL_STATUSES)[number])) {
      if (toleranceDaysUsed > goal.toleranceDaysAllowed) {
        nextStatus = "FAILED";
      } else if (reachedEndDate) {
        nextStatus = "COMPLETED";
      }
    }

    const updatedGoal = await this.prisma.goal.update({
      where: { id: goal.id },
      data: {
        status: nextStatus,
        toleranceDaysUsed
      }
    });

    if (nextStatus === "FAILED") {
      const existingReport = await this.prisma.failureReport.findUnique({
        where: { goalId: updatedGoal.id }
      });

      if (this.shouldQueueFailureReport() && !existingReport) {
        failureReportJob = await this.enqueueFailureReportGeneration(
          updatedGoal,
          missedDays
        );
      } else {
        failureReport = await this.upsertFailureReport(updatedGoal, tasks, missedDays);
        failureReportJob = await this.recordSucceededFailureReportJob(
          updatedGoal,
          failureReport,
          missedDays
        );
      }
    }

    return {
      goal: this.serializeGoal(updatedGoal),
      settlement: {
        status: nextStatus,
        reachedEndDate,
        toleranceDaysUsed,
        toleranceDaysAllowed: goal.toleranceDaysAllowed,
        missedDays
      },
      failureReport: failureReport ? this.serializeFailureReport(failureReport) : null,
      job: failureReportJob ? this.serializeAiJob(failureReportJob) : null
    };
  }

  async processQueuedFailureReportJob(id: string) {
    const job = await this.prisma.aiJob.findUnique({
      where: { id }
    });

    if (!job) {
      throw new NotFoundException("AI 任务不存在");
    }

    if (job.type !== FAILURE_REPORT_GENERATION) {
      throw new BadRequestException(`不支持的失败复盘任务类型：${job.type}`);
    }

    if (job.status !== "QUEUED") {
      return {
        job: this.serializeAiJob(job),
        processed: false,
        reason: "AI job is not queued."
      };
    }

    const payload = this.jsonObject(job.payload);
    const goalId = typeof payload.goalId === "string" ? payload.goalId : job.goalId;

    if (!goalId) {
      return this.failFailureReportJob(
        job,
        "Queued failure report job is missing goalId."
      );
    }

    const goal = await this.prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: job.userId
      }
    });

    if (!goal) {
      return this.failFailureReportJob(
        job,
        "Failure report goal was not found for the job owner."
      );
    }

    if (goal.status !== "FAILED") {
      return this.failFailureReportJob(
        job,
        "Failure report generation requires a failed goal."
      );
    }

    const maxAttempts = 3;
    const failuresBeforeSuccess =
      typeof payload.providerFailuresBeforeSuccess === "number"
        ? Math.max(0, Math.floor(payload.providerFailuresBeforeSuccess))
        : 0;
    let currentJob = job;

    while (currentJob.attempts < maxAttempts) {
      currentJob = await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: "RUNNING",
          attempts: {
            increment: 1
          }
        }
      });

      try {
        if (
          payload.simulateProviderFailure === true ||
          currentJob.attempts <= failuresBeforeSuccess
        ) {
          throw new Error("simulated failure report provider failure");
        }

        const tasks = await this.getGoalSettlementTasks(goal.id);
        const missedDays = this.getMissedTaskDays(tasks);
        const report = await this.upsertFailureReport(goal, tasks, missedDays);
        const succeededJob = await this.prisma.aiJob.update({
          where: { id: currentJob.id },
          data: {
            status: "SUCCEEDED",
            result: {
              failureReportId: report.id,
              missedDayCount: missedDays.length,
              provider: "rule-failure-report"
            },
            error: null
          }
        });

        return {
          job: this.serializeAiJob(succeededJob),
          processed: true,
          failureReport: this.serializeFailureReport(report)
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failure report generation failed";

        if (currentJob.attempts >= maxAttempts) {
          return this.failFailureReportJob(currentJob, message);
        }

        currentJob = await this.prisma.aiJob.update({
          where: { id: currentJob.id },
          data: {
            status: "RETRYING",
            error: message
          }
        });
      }
    }

    return this.failFailureReportJob(
      currentJob,
      currentJob.error ?? "Failure report generation exhausted retries"
    );
  }

  async getFailureReport(userId: string, id: string) {
    const goal = await this.getOwnedGoal(userId, id);
    let report = await this.prisma.failureReport.findUnique({
      where: { goalId: goal.id },
      include: { goal: true }
    });

    if (!report && goal.status !== "FAILED") {
      const settlement = await this.settleGoal(userId, id);

      if (settlement.failureReport) {
        return settlement.failureReport;
      }
    }

    if (!report && goal.status === "FAILED") {
      if (this.shouldQueueFailureReport()) {
        const job = await this.prisma.aiJob.findFirst({
          where: {
            userId,
            goalId: goal.id,
            type: FAILURE_REPORT_GENERATION
          },
          orderBy: { createdAt: "desc" }
        });

        if (job?.status === "FAILED") {
          throw new NotFoundException(`失败复盘生成失败：${job.error ?? "未知错误"}`);
        }

        if (job?.status === "CANCELLED") {
          throw new NotFoundException("失败复盘生成已取消，请重新结算目标后再试");
        }

        throw new NotFoundException("失败复盘正在生成");
      }

      const tasks = await this.getGoalSettlementTasks(goal.id);
      const createdReport = await this.upsertFailureReport(
        goal,
        tasks,
        this.getMissedTaskDays(tasks)
      );
      await this.recordSucceededFailureReportJob(
        goal,
        createdReport,
        this.getMissedTaskDays(tasks)
      );
      return this.serializeFailureReport(createdReport);
    }

    if (!report) {
      throw new NotFoundException("失败报告不存在");
    }

    return this.serializeFailureReport(report);
  }

  async restartGoal(userId: string, id: string, input: unknown) {
    const original = await this.getOwnedGoal(userId, id);

    if (original.status !== "FAILED") {
      throw new BadRequestException("只有失败目标可以重新开启");
    }

    const payload = this.parseRestartGoalPayload(input);
    const startDate = payload.startDate ?? this.getDateRange(this.toDateKey(new Date())).start;
    const endDate = payload.endDate ?? this.addDays(startDate, this.getGoalDurationDays(original));
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        title: payload.title ?? `${original.title}（重新开始）`,
        description: payload.description ?? original.description,
        category: original.category,
        status: "DRAFT",
        startDate,
        endDate,
        dailyTimeBudgetMinutes:
          payload.dailyTimeBudgetMinutes ?? original.dailyTimeBudgetMinutes,
        toleranceDaysAllowed:
          payload.toleranceDaysAllowed ?? original.toleranceDaysAllowed,
        currentBaseline: original.currentBaseline,
        constraints: original.constraints,
        finalReward: original.finalReward
      }
    });

    return {
      goal: this.serializeGoal(goal),
      sourceGoalId: original.id
    };
  }

  private async getOwnedGoal(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    return goal;
  }

  private async getGoalSettlementTasks(goalId: string) {
    return this.prisma.dailyTask.findMany({
      where: {
        goalId
      },
      orderBy: {
        taskDate: "asc"
      },
      include: {
        checkins: {
          orderBy: {
            submittedAt: "desc"
          },
          include: {
            aiScore: true
          }
        }
      }
    });
  }

  private getMissedTaskDays(tasks: GoalSettlementTask[]) {
    const tasksByDate = new Map<string, GoalSettlementTask[]>();

    for (const task of tasks) {
      const dateKey = this.toDateKey(task.taskDate);
      const dateTasks = tasksByDate.get(dateKey) ?? [];
      dateTasks.push(task);
      tasksByDate.set(dateKey, dateTasks);
    }

    return Array.from(tasksByDate.entries())
      .filter(([, dateTasks]) => !dateTasks.some((task) => this.isTaskCompleted(task)))
      .map(([date, dateTasks]) => ({
        date,
        taskCount: dateTasks.length,
        pendingTaskTitles: dateTasks
          .filter((task) => !this.isTaskCompleted(task))
          .map((task) => task.title)
      }));
  }

  private async upsertFailureReport(
    goal: Goal,
    tasks: GoalSettlementTask[],
    missedDays: ReturnType<GoalsService["getMissedTaskDays"]>
  ) {
    const [lowScoreTasks, keyDeviationNodes] = await Promise.all([
      this.getLowScoreTasks(goal.id),
      this.getKeyDeviationNodes(goal.id)
    ]);
    const restartGoalDraft = {
      title: `${goal.title}（重新开始）`,
      description: goal.description,
      category: goal.category,
      dailyTimeBudgetMinutes: goal.dailyTimeBudgetMinutes,
      toleranceDaysAllowed: goal.toleranceDaysAllowed,
      currentBaseline: goal.currentBaseline,
      constraints: goal.constraints,
      finalReward: goal.finalReward
    };
    const reasonAnalysis = this.buildFailureReasonAnalysis({
      goal,
      missedDays,
      lowScoreTaskCount: lowScoreTasks.length,
      keyDeviationCount: keyDeviationNodes.length
    });
    const suggestion = this.buildFailureSuggestion(goal, missedDays, lowScoreTasks.length);
    const data = {
      reasonAnalysis,
      brokenStreakTimeline: this.toJson(missedDays),
      lowScoreTasks: this.toJson(lowScoreTasks),
      keyDeviationNodes: this.toJson(keyDeviationNodes),
      suggestion,
      restartGoalDraft: this.toJson(restartGoalDraft)
    };
    const existing = await this.prisma.failureReport.findUnique({
      where: { goalId: goal.id }
    });

    if (existing) {
      return this.prisma.failureReport.update({
        where: { id: existing.id },
        data
      });
    }

    return this.prisma.failureReport.create({
      data: {
        goalId: goal.id,
        ...data
      }
    });
  }

  private async getLowScoreTasks(goalId: string) {
    const checkins = await this.prisma.checkin.findMany({
      where: {
        goalId,
        aiScore: {
          totalScore: {
            lt: 70
          }
        }
      },
      orderBy: {
        submittedAt: "desc"
      },
      take: 10,
      include: {
        dailyTask: true,
        aiScore: true
      }
    });

    return checkins.map((checkin) => ({
      checkinId: checkin.id,
      dailyTaskId: checkin.dailyTaskId,
      taskTitle: checkin.dailyTask?.title ?? "未关联任务复盘",
      submittedAt: checkin.submittedAt.toISOString(),
      totalScore: checkin.aiScore?.totalScore ?? null,
      summary: checkin.aiScore?.summary ?? null,
      suggestion: checkin.aiScore?.suggestion ?? null
    }));
  }

  private async getKeyDeviationNodes(goalId: string) {
    const events = await this.prisma.deviationEvent.findMany({
      where: {
        goalId
      },
      orderBy: {
        detectedAt: "desc"
      },
      take: 10
    });

    return events.map((event) => ({
      id: event.id,
      detectedAt: event.detectedAt.toISOString(),
      riskLevel: event.riskLevel,
      primaryReasonCode: event.primaryReasonCode,
      primaryReasonLabel: event.primaryReasonLabel,
      primaryReasonDetail: event.primaryReasonDetail,
      metrics: event.metrics
    }));
  }

  private buildFailureReasonAnalysis(input: {
    goal: Goal;
    missedDays: ReturnType<GoalsService["getMissedTaskDays"]>;
    lowScoreTaskCount: number;
    keyDeviationCount: number;
  }) {
    const parts = [
      `目标「${input.goal.title}」已使用 ${input.missedDays.length} 天容错，超过允许的 ${input.goal.toleranceDaysAllowed} 天。`
    ];

    if (input.lowScoreTaskCount > 0) {
      parts.push(`期间出现 ${input.lowScoreTaskCount} 次低分复盘，说明执行质量或证据记录不足。`);
    }

    if (input.keyDeviationCount > 0) {
      parts.push(`系统记录了 ${input.keyDeviationCount} 个关键偏差节点，可作为重开目标时缩小计划颗粒度的依据。`);
    }

    return parts.join("");
  }

  private buildFailureSuggestion(
    goal: Goal,
    missedDays: ReturnType<GoalsService["getMissedTaskDays"]>,
    lowScoreTaskCount: number
  ) {
    const dailyMinutes = goal.dailyTimeBudgetMinutes ?? 30;
    const nextMinutes = Math.max(10, Math.round(dailyMinutes * 0.6));
    const qualityHint =
      lowScoreTaskCount > 0
        ? "每次复盘补充一个可验证成果，优先提升证据质量。"
        : "先保留文本复盘习惯，避免重新开始后再次断档。";

    return `建议重新开启一个更小的新目标：每日投入先降到 ${nextMinutes} 分钟，连续 7 天只追踪一个最小动作。${qualityHint}最近断签 ${missedDays.length} 天，重开后先把容错次数留给突发情况，而不是计划过载。`;
  }

  private parseRestartGoalPayload(input: unknown): RestartGoalPayload {
    if (!input || typeof input !== "object") {
      return {};
    }

    const body = input as Record<string, unknown>;
    const startDate =
      typeof body.startDate === "string" && body.startDate
        ? this.parseDate(body.startDate, "开始日期不正确")
        : undefined;
    const endDate =
      typeof body.endDate === "string" && body.endDate
        ? this.parseDate(body.endDate, "结束日期不正确")
        : undefined;
    const dailyTimeBudgetMinutes = this.parseOptionalInteger(
      body.dailyTimeBudgetMinutes,
      "每日投入时间必须是正整数"
    );
    const toleranceDaysAllowed = this.parseOptionalInteger(
      body.toleranceDaysAllowed,
      "容错次数必须是非负整数"
    );

    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException("结束日期不能早于开始日期");
    }

    if (dailyTimeBudgetMinutes !== undefined && dailyTimeBudgetMinutes <= 0) {
      throw new BadRequestException("每日投入时间必须大于 0");
    }

    if (
      toleranceDaysAllowed !== undefined &&
      (toleranceDaysAllowed < 0 || toleranceDaysAllowed > 366)
    ) {
      throw new BadRequestException("容错次数范围应为 0 到 366");
    }

    return {
      title: this.cleanText(body.title, 80) || undefined,
      description: this.cleanText(body.description, 2000) || undefined,
      startDate,
      endDate,
      dailyTimeBudgetMinutes,
      toleranceDaysAllowed
    };
  }

  private getGoalDurationDays(goal: Goal) {
    const start = this.getDateRange(this.toDateKey(goal.startDate)).start;
    const end = this.getDateRange(this.toDateKey(goal.endDate)).start;
    const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);

    return Math.max(1, diff);
  }

  private addDays(date: Date, days: number) {
    const next = new Date(date);
    next.setUTCDate(date.getUTCDate() + days);
    return next;
  }

  private async getGoalHealthContext(userId: string, id: string) {
    const goal = await this.prisma.goal.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!goal) {
      throw new NotFoundException("目标不存在");
    }

    const todayKey = this.toDateKey(new Date());
    const { start: todayStart, end: todayEnd } = this.getDateRange(todayKey);
    const { start: weekStart, end: weekEnd } = this.getWeekRange(todayStart);
    const { start: recentStart, end: recentEnd } = this.getRecentRange(todayStart, 7);
    const [todayTasks, weekTasks, allTasks, recentCheckins] = await Promise.all([
      this.prisma.dailyTask.findMany({
        where: {
          goalId: goal.id,
          taskDate: {
            gte: todayStart,
            lt: todayEnd
          }
        },
        include: this.healthTaskInclude()
      }),
      this.prisma.dailyTask.findMany({
        where: {
          goalId: goal.id,
          taskDate: {
            gte: weekStart,
            lt: weekEnd
          }
        },
        include: this.healthTaskInclude()
      }),
      this.prisma.dailyTask.findMany({
        where: {
          goalId: goal.id,
          taskDate: {
            lte: todayEnd
          }
        },
        orderBy: {
          taskDate: "asc"
        },
        include: this.healthTaskInclude()
      }),
      this.prisma.checkin.findMany({
        where: {
          goalId: goal.id,
          submittedAt: {
            gte: recentStart,
            lt: recentEnd
          }
        },
        orderBy: {
          submittedAt: "asc"
        },
        include: {
          aiScore: true
        }
      })
    ]);

    return {
      goal,
      todayTasks,
      weekTasks,
      allTasks,
      recentCheckins,
      todayStart,
      todayEnd,
      recentStart,
      recentEnd
    };
  }

  private parseCreateGoalPayload(input: unknown): CreateGoalPayload {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const description = this.cleanText(body.description, 2000);
    const title = this.cleanText(body.title, 80) || this.deriveTitle(description);
    const category = this.parseCategory(body.category);
    const startDate = this.parseDate(body.startDate, "开始日期不正确");
    const endDate = this.parseDate(body.endDate, "结束日期不正确");
    const dailyTimeBudgetMinutes = this.parseOptionalInteger(
      body.dailyTimeBudgetMinutes,
      "每日投入时间必须是正整数"
    );
    const dailyStudyMinutes =
      this.parseOptionalInteger(body.dailyStudyMinutes, "每日学习时间必须是正整数") ??
      dailyTimeBudgetMinutes;
    const studyDaysPerWeek = this.parseOptionalInteger(
      body.studyDaysPerWeek,
      "每周学习天数必须是正整数"
    );
    const toleranceDaysAllowed =
      this.parseOptionalInteger(body.toleranceDaysAllowed, "容错次数必须是非负整数") ??
      0;
    const examDate =
      typeof body.examDate === "string" && body.examDate
        ? this.parseDate(body.examDate, "考试日期不正确")
        : undefined;

    if (!description) {
      throw new BadRequestException("请输入目标描述");
    }

    if (!title) {
      throw new BadRequestException("请输入目标标题");
    }

    if (endDate < startDate) {
      throw new BadRequestException("结束日期不能早于开始日期");
    }

    if (dailyTimeBudgetMinutes !== undefined && dailyTimeBudgetMinutes <= 0) {
      throw new BadRequestException("每日投入时间必须大于 0");
    }

    if (dailyStudyMinutes !== undefined && dailyStudyMinutes <= 0) {
      throw new BadRequestException("每日学习时间必须大于 0");
    }

    if (
      studyDaysPerWeek !== undefined &&
      (studyDaysPerWeek < 1 || studyDaysPerWeek > 7)
    ) {
      throw new BadRequestException("每周学习天数必须在 1 到 7 天之间");
    }

    if (toleranceDaysAllowed < 0 || toleranceDaysAllowed > 366) {
      throw new BadRequestException("容错次数范围应为 0 到 366");
    }

    return {
      title,
      description,
      category,
      startDate,
      endDate,
      dailyTimeBudgetMinutes,
      examName: this.cleanText(body.examName, 120) || undefined,
      targetScore: this.cleanText(body.targetScore, 80) || undefined,
      currentScore: this.cleanText(body.currentScore, 80) || undefined,
      examDate,
      subjects: this.parseStringList(body.subjects),
      materials: this.parseStringList(body.materials),
      chapters: this.parseStringList(body.chapters),
      weaknesses: this.parseStringList(body.weaknesses),
      studyDaysPerWeek,
      dailyStudyMinutes,
      mockExamFrequency: this.cleanText(body.mockExamFrequency, 120) || undefined,
      toleranceDaysAllowed,
      currentBaseline: this.cleanText(body.currentBaseline, 1000) || undefined,
      constraints: this.cleanText(body.constraints, 1000) || undefined,
      finalReward: this.cleanText(body.finalReward, 1000) || undefined
    };
  }

  private cleanText(value: unknown, maxLength: number) {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().slice(0, maxLength);
  }

  private parseStringList(value: unknown) {
    const source = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,，\n]/)
        : [];
    const list = source
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 50);

    return list.length ? list : undefined;
  }

  private deriveTitle(description: string) {
    return description.replace(/\s+/g, " ").slice(0, 60);
  }

  private parseCategory(value: unknown) {
    if (typeof value !== "string") {
      return "CUSTOM";
    }

    return CATEGORY_MAP[value.toLowerCase()] ?? "CUSTOM";
  }

  private parseDate(value: unknown, errorMessage: string) {
    if (typeof value !== "string" || !value) {
      throw new BadRequestException(errorMessage);
    }

    const date = new Date(`${value}T00:00:00.000+08:00`);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(errorMessage);
    }

    return date;
  }

  private parseOptionalInteger(value: unknown, errorMessage: string) {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const numberValue = Number(value);

    if (!Number.isInteger(numberValue)) {
      throw new BadRequestException(errorMessage);
    }

    return numberValue;
  }

  private healthTaskInclude() {
    return {
      checkins: {
        include: {
          aiScore: true
        }
      }
    } as const;
  }

  private getCompletionRate(tasks: HealthTask[]) {
    if (!tasks.length) {
      return 0;
    }

    const completedCount = tasks.filter((task) => this.isTaskCompleted(task)).length;

    return Math.round((completedCount / tasks.length) * 100);
  }

  private getStreakDays(tasks: HealthTask[], todayStart: Date) {
    const tasksByDate = new Map<string, HealthTask[]>();

    for (const task of tasks) {
      const dateKey = this.toDateKey(task.taskDate);
      const dateTasks = tasksByDate.get(dateKey) ?? [];
      dateTasks.push(task);
      tasksByDate.set(dateKey, dateTasks);
    }

    let streak = 0;

    for (let offset = 0; offset < 366; offset += 1) {
      const date = new Date(todayStart);
      date.setUTCDate(todayStart.getUTCDate() - offset);
      const dateTasks = tasksByDate.get(this.toDateKey(date));

      if (!dateTasks?.some((task) => this.isTaskCompleted(task))) {
        break;
      }

      streak += 1;
    }

    return streak;
  }

  private isTaskCompleted(task: HealthTask) {
    return task.status === DONE_STATUS || task.checkins.some((checkin) => checkin.aiScore);
  }

  private findRescueSourceTask(
    todayTasks: HealthTask[],
    allTasks: HealthTask[],
    todayStart: Date
  ) {
    return (
      todayTasks.find((task) => !this.isTaskCompleted(task)) ??
      allTasks
        .filter((task) => task.taskDate < todayStart && !this.isTaskCompleted(task))
        .sort((left, right) => right.taskDate.getTime() - left.taskDate.getTime())[0] ??
      null
    );
  }

  private async persistDeviationEvent(input: {
    goal: Goal;
    deviation: DeviationSignal;
    sourceTask: HealthTask | null;
    todayStart: Date;
    todayEnd: Date;
  }) {
    if (input.deviation.riskLevel === "stable" || !input.deviation.reasons.length) {
      return null;
    }

    const primaryReason = input.deviation.reasons[0];
    const existingEvent = await this.prisma.deviationEvent.findFirst({
      where: {
        goalId: input.goal.id,
        primaryReasonCode: primaryReason.code,
        detectedAt: {
          gte: input.todayStart,
          lt: input.todayEnd
        }
      },
      orderBy: {
        detectedAt: "desc"
      }
    });
    const data = {
      sourceDailyTaskId:
        input.sourceTask?.id ?? existingEvent?.sourceDailyTaskId ?? null,
      riskLevel: input.deviation.riskLevel,
      primaryReasonCode: primaryReason.code,
      primaryReasonLabel: primaryReason.label,
      primaryReasonDetail: primaryReason.detail,
      reasons: this.toJson(input.deviation.reasons),
      metrics: this.toJson(input.deviation.metrics),
      detectedAt: new Date()
    };

    if (existingEvent) {
      return this.prisma.deviationEvent.update({
        where: { id: existingEvent.id },
        data
      });
    }

    return this.prisma.deviationEvent.create({
      data: {
        goalId: input.goal.id,
        ...data
      }
    });
  }

  private toJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private getAverageScore(checkins: Array<Checkin & { aiScore: AiScore | null }>) {
    const scores = checkins
      .map((checkin) => checkin.aiScore?.totalScore)
      .filter((score): score is number => typeof score === "number");

    if (!scores.length) {
      return null;
    }

    return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  }

  private getRecentInvestedMinutes(
    checkins: Array<Checkin & { aiScore: AiScore | null }>
  ) {
    return checkins.reduce(
      (sum, checkin) => sum + (checkin.investedMinutes ?? 0),
      0
    );
  }

  private buildDeviationSignal(input: {
    goal: Goal;
    todayTasks: HealthTask[];
    allTasks: HealthTask[];
    recentCheckins: Array<Checkin & { aiScore: AiScore | null }>;
    todayStart: Date;
    recentStart: Date;
    recentEnd: Date;
    averageScore: number | null;
    recentInvestedMinutes: number;
    streakDays: number;
  }): DeviationSignal {
    const recentTasks = input.allTasks.filter(
      (task) => task.taskDate >= input.recentStart && task.taskDate < input.recentEnd
    );
    const plannedRecentMinutes = recentTasks.reduce(
      (sum, task) => sum + (task.plannedMinutes ?? 0),
      0
    );
    const expectedRecentMinutes =
      input.goal.dailyTimeBudgetMinutes !== null
        ? input.goal.dailyTimeBudgetMinutes * 7
        : plannedRecentMinutes;
    const overdueTaskCount = input.allTasks.filter(
      (task) => task.taskDate < input.todayStart && !this.isTaskCompleted(task)
    ).length;
    const incompleteTodayTaskCount = input.todayTasks.filter(
      (task) => !this.isTaskCompleted(task)
    ).length;
    const reasons: DeviationReason[] = [];

    if (input.averageScore !== null && input.averageScore < 70) {
      reasons.push({
        code: "LOW_SCORE",
        level: input.averageScore < 60 ? "danger" : "warning",
        label: "低评分",
        detail: `最近平均 AI 评分 ${input.averageScore}，低于 70 分稳定线。`
      });
    }

    if (
      expectedRecentMinutes > 0 &&
      input.recentInvestedMinutes < expectedRecentMinutes * 0.8
    ) {
      const percent = Math.round(
        (input.recentInvestedMinutes / expectedRecentMinutes) * 100
      );

      reasons.push({
        code: "LOW_INVESTMENT",
        level: percent < 50 ? "danger" : "warning",
        label: "低投入",
        detail: `近 7 天投入 ${input.recentInvestedMinutes} 分钟，约为预期 ${expectedRecentMinutes} 分钟的 ${percent}%。`
      });
    }

    if (
      input.streakDays === 0 &&
      (input.todayTasks.length > 0 || input.recentCheckins.length > 0)
    ) {
      reasons.push({
        code: "BROKEN_STREAK",
        level: incompleteTodayTaskCount > 0 ? "danger" : "warning",
        label: "断签",
        detail: incompleteTodayTaskCount
          ? `今天还有 ${incompleteTodayTaskCount} 个任务未完成，连续完成已中断。`
          : "最近连续完成天数为 0，需要先恢复最小执行节奏。"
      });
    }

    if (overdueTaskCount > 0) {
      reasons.push({
        code: "TASK_DELAY",
        level: overdueTaskCount >= 3 ? "danger" : "warning",
        label: "任务延期",
        detail: `已有 ${overdueTaskCount} 个历史任务未完成。`
      });
    }

    return {
      riskLevel: reasons.some((reason) => reason.level === "danger")
        ? "danger"
        : reasons.length
          ? "warning"
          : "stable",
      reasons,
      metrics: {
        averageScore: input.averageScore,
        recentInvestedMinutes: input.recentInvestedMinutes,
        expectedRecentMinutes,
        streakDays: input.streakDays,
        overdueTaskCount,
        incompleteTodayTaskCount
      }
    };
  }

  private buildMockRescueTask(goal: Goal, deviation: DeviationSignal) {
    const primaryReason = deviation.reasons[0];
    const fallbackMinutes = Math.min(
      25,
      Math.max(10, Math.round((goal.dailyTimeBudgetMinutes ?? 30) / 2))
    );

    if (!primaryReason) {
      return {
        title: "完成一次轻量巩固任务",
        description: `围绕「${goal.title}」选择一个最小可交付动作，完成后写下 2 句复盘。`,
        estimatedMinutes: fallbackMinutes,
        reason: "当前节奏稳定，用低压力任务保持连续性。",
        triggerCode: null,
        createdAt: new Date().toISOString()
      };
    }

    const templates: Record<
      DeviationReasonCode,
      { title: string; description: string; estimatedMinutes: number }
    > = {
      LOW_SCORE: {
        title: "补一条可验证成果",
        description:
          "回到最近一次低分任务，补充一个截图、笔记、数据或具体产出，并用 3 句话说明它如何推进目标。",
        estimatedMinutes: Math.min(20, fallbackMinutes)
      },
      LOW_INVESTMENT: {
        title: "做 15 分钟最小推进",
        description:
          "只选一个不会卡住的小动作：阅读一页、整理一个知识点、快走一小段或完成一个微练习，到点即停。",
        estimatedMinutes: Math.min(15, fallbackMinutes)
      },
      BROKEN_STREAK: {
        title: "恢复连续性的低压打卡",
        description:
          "完成一个 10 分钟内能结束的目标相关动作，并提交一句完成事实，先把今天的执行链路接回来。",
        estimatedMinutes: 10
      },
      TASK_DELAY: {
        title: "清理一个延期任务的最小版本",
        description:
          "从延期任务里选最容易的一项，只完成原计划的第一步，并记录剩余部分明天如何继续。",
        estimatedMinutes: Math.min(20, fallbackMinutes)
      }
    };
    const template = templates[primaryReason.code];

    return {
      ...template,
      reason: primaryReason.detail,
      triggerCode: primaryReason.code,
      createdAt: new Date().toISOString()
    };
  }

  private buildHealthCompletionMetrics(input: {
    todayTasks: HealthTask[];
    weekTasks: HealthTask[];
    allTasks: HealthTask[];
    recentStart: Date;
    recentEnd: Date;
  }): HealthCompletionMetrics {
    const recentTasks = input.allTasks.filter(
      (task) => task.taskDate >= input.recentStart && task.taskDate < input.recentEnd
    );
    const recentNormalTasks = recentTasks.filter(
      (task) => task.taskType !== RESCUE_TASK_TYPE
    );
    const recentRescueTasks = recentTasks.filter(
      (task) => task.taskType === RESCUE_TASK_TYPE
    );
    const normalStats = this.getTaskCompletionStats(recentNormalTasks);
    const rescueStats = this.getTaskCompletionStats(recentRescueTasks);

    return {
      todayCompletionRate: this.getCompletionRate(input.todayTasks),
      weekCompletionRate: this.getCompletionRate(input.weekTasks),
      recentNormalTaskCount: normalStats.totalCount,
      recentNormalTaskCompletedCount: normalStats.completedCount,
      recentNormalTaskCompletionRate: normalStats.completionRate,
      recentRescueTaskCount: rescueStats.totalCount,
      recentRescueTaskCompletedCount: rescueStats.completedCount,
      recentRescueTaskCompletionRate: rescueStats.completionRate,
      taskTypeWeights: {
        normal: 1,
        rescue: 0.6
      }
    };
  }

  private buildHealthRescueMetrics(input: {
    allTasks: HealthTask[];
    recentStart: Date;
    recentEnd: Date;
    todayStart: Date;
  }): HealthRescueMetrics {
    const recentRescueTasks = input.allTasks.filter(
      (task) =>
        task.taskType === RESCUE_TASK_TYPE &&
        task.taskDate >= input.recentStart &&
        task.taskDate < input.recentEnd
    );
    const rescueStats = this.getTaskCompletionStats(recentRescueTasks);
    const completedRescueTasks = recentRescueTasks
      .filter((task) => this.isTaskCompleted(task))
      .sort((left, right) => right.taskDate.getTime() - left.taskDate.getTime());
    const lastCompletedRescueTask = completedRescueTasks[0] ?? null;
    const nextDayRecovery = lastCompletedRescueTask
      ? this.getNextDayNormalRecovery({
          allTasks: input.allTasks,
          rescueTaskDate: lastCompletedRescueTask.taskDate,
          todayStart: input.todayStart
        })
      : {
          recovered: null,
          completionRate: null
        };

    return {
      recentRescueSuccessCount: rescueStats.completedCount,
      rescueTaskCompletionRate: rescueStats.completionRate,
      rescueNextDayRecovered: nextDayRecovery.recovered,
      nextDayNormalTaskCompletionRate: nextDayRecovery.completionRate,
      lastCompletedRescueTaskId: lastCompletedRescueTask?.id ?? null
    };
  }

  private getTaskCompletionStats(tasks: HealthTask[]) {
    const completedCount = tasks.filter((task) => this.isTaskCompleted(task)).length;

    return {
      totalCount: tasks.length,
      completedCount,
      completionRate: tasks.length
        ? Math.round((completedCount / tasks.length) * 100)
        : 0
    };
  }

  private getNextDayNormalRecovery(input: {
    allTasks: HealthTask[];
    rescueTaskDate: Date;
    todayStart: Date;
  }) {
    const nextDayStart = new Date(input.rescueTaskDate);
    nextDayStart.setUTCDate(input.rescueTaskDate.getUTCDate() + 1);
    const nextDayEnd = new Date(nextDayStart);
    nextDayEnd.setUTCDate(nextDayStart.getUTCDate() + 1);

    if (nextDayStart > input.todayStart) {
      return {
        recovered: null,
        completionRate: null
      };
    }

    const nextDayNormalTasks = input.allTasks.filter(
      (task) =>
        task.taskType !== RESCUE_TASK_TYPE &&
        task.taskDate >= nextDayStart &&
        task.taskDate < nextDayEnd
    );

    if (!nextDayNormalTasks.length) {
      return {
        recovered: null,
        completionRate: null
      };
    }

    const stats = this.getTaskCompletionStats(nextDayNormalTasks);

    return {
      recovered: stats.completionRate >= 50,
      completionRate: stats.completionRate
    };
  }

  private getHealthWeights() {
    return {
      healthScoreFormula:
        "20 + todayCompletionRate*0.22 + weekCompletionRate*0.28 + streakBonus(最多15) + averageScore*0.25 + toleranceBonus(最多10) - riskCount*6",
      taskTypeWeights: {
        normal: 1,
        rescue: 0.6
      },
      note:
        "普通任务代表原计划执行，救援任务用于恢复节奏；救援完成计入健康度和热力图，但在任务类型权重说明中低于普通任务。"
    };
  }

  private async upsertHealthSnapshot(input: {
    goal: Goal;
    date: Date;
    healthScore: number;
    deviationEvent: DeviationEvent | null;
    completionMetrics: HealthCompletionMetrics;
    rescueMetrics: HealthRescueMetrics;
    riskLevel: DeviationRiskLevel;
  }) {
    return this.prisma.healthSnapshot.upsert({
      where: {
        goalId_date: {
          goalId: input.goal.id,
          date: input.date
        }
      },
      update: {
        healthScore: input.healthScore,
        deviationEventId: input.deviationEvent?.id ?? null,
        completionMetrics: this.toJson(input.completionMetrics),
        rescueMetrics: this.toJson(input.rescueMetrics),
        riskLevel: input.riskLevel
      },
      create: {
        goalId: input.goal.id,
        date: input.date,
        healthScore: input.healthScore,
        deviationEventId: input.deviationEvent?.id ?? null,
        completionMetrics: this.toJson(input.completionMetrics),
        rescueMetrics: this.toJson(input.rescueMetrics),
        riskLevel: input.riskLevel
      }
    });
  }

  private buildHealthRisks(input: {
    todayCompletionRate: number;
    weekCompletionRate: number;
    streakDays: number;
    averageScore: number | null;
    toleranceRemaining: number;
    deviation: DeviationSignal;
  }) {
    const risks: Array<{
      level: "warning" | "danger";
      title: string;
      detail: string;
      suggestion: string;
    }> = [];

    if (input.weekCompletionRate < 60) {
      risks.push({
        level: "danger",
        title: "本周完成率偏低",
        detail: `当前本周完成率 ${input.weekCompletionRate}%。`,
        suggestion: "今晚只完成最小任务，先恢复执行节奏。"
      });
    }

    if (input.streakDays === 0) {
      risks.push({
        level: "warning",
        title: "连续完成中断",
        detail: "最近连续完成天数为 0。",
        suggestion: "今天优先完成一个低压力任务，避免继续断档。"
      });
    }

    if (input.averageScore !== null && input.averageScore < 70) {
      risks.push({
        level: "warning",
        title: "任务质量偏低",
        detail: `最近平均 AI 评分 ${input.averageScore}。`,
        suggestion: "复盘时补充可验证成果，减少只写过程描述。"
      });
    }

    if (input.toleranceRemaining <= 1) {
      risks.push({
        level: "danger",
        title: "容错余额不足",
        detail: `剩余容错 ${input.toleranceRemaining} 次。`,
        suggestion: "未来 3 天降低任务规模，优先保证不断签。"
      });
    }

    for (const reason of input.deviation.reasons) {
      if (reason.code === "LOW_INVESTMENT") {
        risks.push({
          level: reason.level,
          title: "近 7 天投入不足",
          detail: reason.detail,
          suggestion: "先生成一个 10-15 分钟救援任务，恢复行动惯性。"
        });
      }

      if (reason.code === "TASK_DELAY") {
        risks.push({
          level: reason.level,
          title: "存在延期任务",
          detail: reason.detail,
          suggestion: "今天只处理一个延期任务的最小版本，避免积压继续扩大。"
        });
      }
    }

    return risks;
  }

  private getHealthScore(input: {
    todayCompletionRate: number;
    weekCompletionRate: number;
    streakDays: number;
    averageScore: number | null;
    toleranceRemaining: number;
    riskCount: number;
  }) {
    const score =
      20 +
      input.todayCompletionRate * 0.22 +
      input.weekCompletionRate * 0.28 +
      Math.min(15, input.streakDays * 3) +
      (input.averageScore ?? 70) * 0.25 +
      Math.min(10, input.toleranceRemaining * 2) -
      input.riskCount * 6;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private getDateRange(dateKey: string) {
    const start = new Date(`${dateKey}T00:00:00.000+08:00`);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 1);

    return { start, end };
  }

  private getWeekRange(todayStart: Date) {
    const weekStart = new Date(todayStart);
    const day = weekStart.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    weekStart.setUTCDate(weekStart.getUTCDate() + mondayOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

    return { start: weekStart, end: weekEnd };
  }

  private getRecentRange(todayStart: Date, days: number) {
    const start = new Date(todayStart);
    start.setUTCDate(todayStart.getUTCDate() - (days - 1));
    const end = new Date(todayStart);
    end.setUTCDate(todayStart.getUTCDate() + 1);

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

  private serializeAiJob(job: AiJob) {
    return {
      id: job.id,
      userId: job.userId,
      goalId: job.goalId,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      payload: job.payload,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    };
  }

  private serializeGoal(goal: Goal) {
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      category: goal.category,
      status: goal.status,
      startDate: goal.startDate.toISOString(),
      endDate: goal.endDate.toISOString(),
      timezone: goal.timezone,
      toleranceDaysAllowed: goal.toleranceDaysAllowed,
      toleranceDaysUsed: goal.toleranceDaysUsed,
      dailyTimeBudgetMinutes: goal.dailyTimeBudgetMinutes,
      examName: goal.examName,
      targetScore: goal.targetScore,
      currentScore: goal.currentScore,
      examDate: goal.examDate?.toISOString() ?? null,
      subjects: this.jsonArray(goal.subjects),
      materials: this.jsonArray(goal.materials),
      chapters: this.jsonArray(goal.chapters),
      weaknesses: this.jsonArray(goal.weaknesses),
      studyDaysPerWeek: goal.studyDaysPerWeek,
      dailyStudyMinutes: goal.dailyStudyMinutes,
      mockExamFrequency: goal.mockExamFrequency,
      currentBaseline: goal.currentBaseline,
      constraints: goal.constraints,
      finalReward: goal.finalReward,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString()
    };
  }

  private serializeReportArtifact(artifact: ReportArtifact) {
    return {
      id: artifact.id,
      goalId: artifact.goalId,
      type: artifact.type,
      periodStart: this.toDateKey(artifact.periodStart),
      periodEnd: this.toDateKey(artifact.periodEnd),
      title: artifact.title,
      summary: artifact.summary,
      recommendations: this.jsonArray(artifact.recommendations),
      provider: artifact.provider,
      model: artifact.model,
      promptVersion: artifact.promptVersion,
      status: artifact.status,
      error: artifact.error,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString()
    };
  }

  private serializeFailureReport(report: FailureReport | GoalFailureReport) {
    return {
      id: report.id,
      goalId: report.goalId,
      goalTitle: "goal" in report ? report.goal.title : undefined,
      reasonAnalysis: report.reasonAnalysis,
      brokenStreakTimeline: this.jsonArray(report.brokenStreakTimeline),
      lowScoreTasks: this.jsonArray(report.lowScoreTasks),
      keyDeviationNodes: this.jsonArray(report.keyDeviationNodes),
      suggestion: report.suggestion,
      restartGoalDraft: this.jsonObject(report.restartGoalDraft),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString()
    };
  }

  private jsonArray(value: unknown) {
    return Array.isArray(value) ? value : [];
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private serializeDeviationSignal(
    deviation: DeviationSignal,
    event: DeviationEvent | null
  ) {
    return {
      ...deviation,
      eventId: event?.id ?? null,
      detectedAt: event?.detectedAt.toISOString() ?? null
    };
  }

  private serializeHealthSnapshot(snapshot: HealthSnapshot) {
    return {
      id: snapshot.id,
      goalId: snapshot.goalId,
      date: this.toDateKey(snapshot.date),
      healthScore: snapshot.healthScore,
      deviationEventId: snapshot.deviationEventId,
      completionMetrics: this.jsonObject(snapshot.completionMetrics),
      rescueMetrics: this.jsonObject(snapshot.rescueMetrics),
      riskLevel: snapshot.riskLevel,
      createdAt: snapshot.createdAt.toISOString(),
      updatedAt: snapshot.updatedAt.toISOString()
    };
  }

  private serializeRescueTask(goal: Goal, task: DailyTask) {
    return {
      id: task.id,
      goalId: task.goalId,
      goalTitle: goal.title,
      weeklyPlanId: task.weeklyPlanId,
      weeklyPlanTitle: null,
      sourceDailyTaskId: task.sourceDailyTaskId,
      deviationEventId: task.deviationEventId,
      taskDate: task.taskDate.toISOString(),
      date: this.toDateKey(task.taskDate),
      title: task.title,
      description: task.description,
      plannedMinutes: task.plannedMinutes,
      estimatedMinutes: task.plannedMinutes ?? 0,
      studyTaskType: task.studyTaskType,
      subject: task.subject,
      materialRef: task.materialRef,
      chapterRef: task.chapterRef,
      questionCount: task.questionCount,
      targetAccuracy: task.targetAccuracy,
      evidenceRequired: task.evidenceRequired,
      priority: task.priority,
      taskType: task.taskType,
      rescueReason: task.rescueReason,
      rescueTriggerCode: task.rescueTriggerCode,
      rescueRiskLevel: task.rescueRiskLevel,
      reason: task.rescueReason ?? "系统生成的低压力补救动作。",
      triggerCode: task.rescueTriggerCode,
      riskLevel: task.rescueRiskLevel,
      status: task.status,
      latestCheckin: null,
      createdAt: task.createdAt.toISOString()
    };
  }
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(date.getUTCDate() + days);
  return next;
}

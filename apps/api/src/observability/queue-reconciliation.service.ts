import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";

@Injectable()
export class QueueReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueService) private readonly queues: QueueService
  ) {}

  onModuleInit() {
    if (process.env.QUEUE_RECONCILIATION_ENABLED !== "true") return;
    const intervalMs = Math.max(30_000, Number(process.env.QUEUE_RECONCILIATION_INTERVAL_MS || 60_000));
    this.timer = setInterval(() => void this.reconcile().catch((error) => {
      process.stderr.write(`${JSON.stringify({ level: "error", event: "queue_reconciliation_failed", error: error instanceof Error ? error.message : "Unknown error", timestamp: new Date().toISOString() })}\n`);
    }), intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile(input: { olderThanMs?: number; limit?: number; dryRun?: boolean; userId?: string } = {}) {
    const olderThanMs = Math.max(5_000, input.olderThanMs ?? Number(process.env.QUEUE_RECONCILIATION_GRACE_MS || 30_000));
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const cutoff = new Date(Date.now() - olderThanMs);
    const [jobs, emails] = await Promise.all([
      this.prisma.aiJob.findMany({ where: { userId: input.userId, status: "QUEUED", createdAt: { lte: cutoff } }, orderBy: { createdAt: "asc" }, take: limit }),
      this.prisma.emailLog.findMany({ where: { userId: input.userId, status: "QUEUED", createdAt: { lte: cutoff }, OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }] }, orderBy: { createdAt: "asc" }, take: limit })
    ]);
    if (input.dryRun) return { dryRun: true, cutoff: cutoff.toISOString(), aiJobsFound: jobs.length, emailLogsFound: emails.length, recovered: 0 };

    const results: Array<{ resourceType: string; resourceId: string; queued: boolean; queueName: string }> = [];
    for (const job of jobs) {
      const payload = jsonObject(job.payload);
      const queueResult = job.type.startsWith("REPORT_")
        ? await this.queues.enqueueReportJob({ aiJobId: job.id, type: String(payload.type ?? job.type.slice(7)), userId: job.userId, goalId: job.goalId ?? String(payload.goalId ?? ""), reportDate: typeof payload.reportDate === "string" ? payload.reportDate : null })
        : await this.queues.enqueueAiJob({ jobId: job.id, type: job.type, userId: job.userId, goalId: job.goalId });
      results.push({ resourceType: "AI_JOB", resourceId: job.id, queued: queueResult.queued, queueName: queueResult.queueName });
      await this.prisma.aiJob.update({ where: { id: job.id }, data: { payload: { ...payload, reconciliation: { attemptedAt: new Date().toISOString(), queue: queueResult } } as Prisma.InputJsonValue } });
    }
    for (const email of emails) {
      const queueResult = await this.queues.enqueueEmailLog({ emailLogId: email.id, userId: email.userId, type: email.type });
      results.push({ resourceType: "EMAIL_LOG", resourceId: email.id, queued: queueResult.queued, queueName: queueResult.queueName });
    }
    return { dryRun: false, cutoff: cutoff.toISOString(), aiJobsFound: jobs.length, emailLogsFound: emails.length, recovered: results.filter((item) => item.queued).length, results };
  }
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

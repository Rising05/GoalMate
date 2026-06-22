import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { HttpMetricsService } from "./http-metrics.service";

@Injectable()
export class SystemMetricsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(HttpMetricsService) private readonly http: HttpMetricsService
  ) {}

  async readiness() {
    let mysqlUp = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      mysqlUp = true;
    } catch {}
    const queue = await this.queues.getOperationalMetrics();
    return { status: mysqlUp && (!queue.enabled || queue.redisUp) ? "ready" : "unavailable", mysqlUp, redisRequired: queue.enabled, redisUp: queue.redisUp, timestamp: new Date().toISOString() };
  }

  async toPrometheus() {
    const [aiJobs, aiCalls, emails, uploads, objectDeletions, orders, unprocessedPaymentEvents, mysqlStatus, queue] = await Promise.all([
      this.prisma.aiJob.groupBy({ by: ["status", "type"], _count: { _all: true } }),
      this.prisma.aiCallLog.groupBy({ by: ["status", "provider", "errorCategory"], _count: { _all: true }, _sum: { totalTokens: true, estimatedCostMicros: true, latencyMs: true } }),
      this.prisma.emailLog.groupBy({ by: ["status", "channel"], _count: { _all: true } }),
      this.prisma.uploadAsset.groupBy({ by: ["status", "scanStatus"], _count: { _all: true }, _sum: { sizeBytes: true } }),
      this.prisma.objectDeletionJob.groupBy({ by: ["status", "sourceType"], _count: { _all: true } }),
      this.prisma.paymentOrder.groupBy({ by: ["status", "provider"], _count: { _all: true } }),
      this.prisma.paymentEvent.count({ where: { processedAt: null } }),
      this.getMysqlStatus(),
      this.queues.getOperationalMetrics()
    ]);
    const lines = [this.http.toPrometheus(), "# TYPE goalmate_build_info gauge", 'goalmate_build_info{version="0.1.0"} 1'];
    for (const row of aiJobs) lines.push(`goalmate_ai_jobs_total{status="${label(row.status)}",type="${label(row.type)}"} ${row._count._all}`);
    for (const row of aiCalls) {
      const labels = `status="${label(row.status)}",provider="${label(row.provider)}",error_category="${label(row.errorCategory ?? "none")}"`;
      lines.push(`goalmate_ai_provider_calls_total{${labels}} ${row._count._all}`);
      lines.push(`goalmate_ai_provider_tokens_total{${labels}} ${row._sum.totalTokens ?? 0}`);
      lines.push(`goalmate_ai_provider_cost_micros_total{${labels}} ${row._sum.estimatedCostMicros ?? 0}`);
      lines.push(`goalmate_ai_provider_latency_ms_total{${labels}} ${row._sum.latencyMs ?? 0}`);
    }
    for (const row of emails) lines.push(`goalmate_notifications_total{status="${label(row.status)}",channel="${label(row.channel)}"} ${row._count._all}`);
    for (const row of uploads) {
      const labels = `status="${label(row.status)}",scan_status="${label(row.scanStatus)}"`;
      lines.push(`goalmate_upload_assets_total{${labels}} ${row._count._all}`);
      lines.push(`goalmate_upload_storage_bytes{${labels}} ${row._sum.sizeBytes ?? 0}`);
    }
    for (const row of objectDeletions) lines.push(`goalmate_object_deletion_jobs_total{status="${label(row.status)}",source_type="${label(row.sourceType)}"} ${row._count._all}`);
    for (const row of orders) lines.push(`goalmate_payment_orders_total{status="${label(row.status)}",provider="${label(row.provider)}"} ${row._count._all}`);
    lines.push(`goalmate_payment_events_unprocessed ${unprocessedPaymentEvents}`);
    for (const row of mysqlStatus) lines.push(`goalmate_mysql_status{variable="${label(row.Variable_name.toLowerCase())}"} ${Number(row.Value) || 0}`);
    lines.push(`goalmate_queue_enabled ${queue.enabled ? 1 : 0}`);
    lines.push(`goalmate_redis_up ${queue.redisUp ? 1 : 0}`);
    for (const item of queue.queues) {
      const queueItem = item as Record<string, string | number>;
      for (const state of ["waiting", "active", "delayed", "failed", "completed", "paused"]) lines.push(`goalmate_queue_jobs{queue="${label(String(queueItem.name))}",state="${state}"} ${Number(queueItem[state] ?? 0)}`);
    }
    return `${lines.join("\n")}\n`;
  }

  private async getMysqlStatus() {
    try {
      return await this.prisma.$queryRawUnsafe<Array<{ Variable_name: string; Value: string }>>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Slow_queries','Com_commit','Com_rollback','Aborted_connects')");
    } catch {
      return [];
    }
  }
}

function label(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

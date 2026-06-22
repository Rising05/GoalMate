import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { HttpMetricsService } from "./http-metrics.service";
import { QueueReconciliationService } from "./queue-reconciliation.service";
import { SystemMetricsService } from "./system-metrics.service";
import { TraceContextService } from "./trace-context.service";

loadEnv();
const prisma = new PrismaService();
const email = "observability-integration@example.com";

describe("Observability integration", () => {
  before(async () => prisma.user.deleteMany({ where: { email } }));
  after(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("propagates trace context across async work", async () => {
    const traces = new TraceContextService();
    await traces.run({ requestId: "request-test-123", traceId: "trace-test-123" }, async () => {
      await Promise.resolve();
      assert.equal(traces.getRequestId(), "request-test-123");
      assert.equal(traces.getTraceId(), "trace-test-123");
    });
    assert.equal(traces.getTraceId(), undefined);
  });

  it("reconciles persisted queued jobs and records the attempt", async () => {
    const user = await prisma.user.create({ data: { email, passwordHash: "test" } });
    const goal = await prisma.goal.create({ data: { userId: user.id, title: "Queue recovery", description: "test", startDate: new Date(), endDate: new Date(Date.now() + 86400000) } });
    const job = await prisma.aiJob.create({ data: { userId: user.id, goalId: goal.id, type: "GOAL_PLAN_GENERATION", status: "QUEUED", payload: {}, createdAt: new Date(Date.now() - 120000) } });
    await prisma.emailLog.create({ data: { userId: user.id, goalId: goal.id, channel: "EMAIL", type: "DAILY_TASK", recipientEmail: email, subject: "test", content: "test", status: "QUEUED", createdAt: new Date(Date.now() - 120000) } });
    const calls: string[] = [];
    const queue = {
      enqueueAiJob: async (input: { jobId: string }) => { calls.push(`ai:${input.jobId}`); return { queued: true, queueName: "ai-jobs", jobId: input.jobId }; },
      enqueueReportJob: async () => ({ queued: true, queueName: "reports", jobId: "report" }),
      enqueueEmailLog: async (input: { emailLogId: string }) => { calls.push(`email:${input.emailLogId}`); return { queued: true, queueName: "email", jobId: input.emailLogId }; }
    } as unknown as QueueService;
    const service = new QueueReconciliationService(prisma, queue);
    const result = await service.reconcile({ olderThanMs: 5000, userId: user.id });
    assert.equal(result.recovered, 2);
    assert.equal(calls.length, 2);
    const stored = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.match(JSON.stringify(stored.payload), /attemptedAt/);
  });

  it("exports database-backed Prometheus metrics and readiness", async () => {
    const http = new HttpMetricsService();
    http.observe(200, 12);
    http.observe(500, 1200);
    const queue = { getOperationalMetrics: async () => ({ enabled: false, redisUp: false, queues: [] }) } as unknown as QueueService;
    const metrics = new SystemMetricsService(prisma, queue, http);
    assert.equal((await metrics.readiness()).status, "ready");
    const output = await metrics.toPrometheus();
    assert.match(output, /goalmate_http_requests_total 2/);
    assert.match(output, /goalmate_ai_jobs_total/);
    assert.match(output, /goalmate_object_deletion_jobs_total/);
    assert.match(output, /goalmate_mysql_status/);
  });
});

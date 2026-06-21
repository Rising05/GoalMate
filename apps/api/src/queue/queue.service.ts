import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue, Worker } from "bullmq";

interface QueueConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private readonly enabled = process.env.BULLMQ_ENABLED === "true";
  private readonly connection = this.parseRedisConnection(
    process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
  );

  isEnabled() {
    return this.enabled;
  }

  async enqueueAiJob(input: {
    jobId: string;
    type: string;
    goalId?: string | null;
    userId: string;
  }) {
    return this.enqueue("ai-jobs", input.type, input, input.jobId);
  }

  async enqueueEmailLog(input: { emailLogId: string; userId: string; type: string }) {
    return this.enqueue("email", input.type, input, input.emailLogId);
  }

  async enqueueReportJob(input: {
    aiJobId?: string;
    type: string;
    userId: string;
    goalId: string;
    reportDate?: string | null;
  }) {
    return this.enqueue("reports", input.type, input, input.aiJobId);
  }

  async getOperationalMetrics() {
    if (!this.enabled) return { enabled: false, redisUp: false, queues: [] as Array<Record<string, unknown>> };
    const queueNames = ["ai-jobs", "email", "reports"];
    try {
      const queues = await Promise.all(queueNames.map(async (name) => {
        const queue = this.getQueue(name);
        await queue.waitUntilReady();
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused");
        return { name, ...counts };
      }));
      return { enabled: true, redisUp: true, queues };
    } catch (error) {
      return { enabled: true, redisUp: false, error: error instanceof Error ? error.message : "Redis unavailable", queues: [] as Array<Record<string, unknown>> };
    }
  }

  createWorker(
    queueName: string,
    processor: (data: Record<string, unknown>, job: Job) => Promise<unknown>
  ) {
    if (!this.enabled) {
      return {
        started: false,
        queueName,
        reason: "BullMQ is disabled; set BULLMQ_ENABLED=true to start workers."
      };
    }

    if (this.workers.has(queueName)) {
      return {
        started: true,
        queueName,
        existing: true
      };
    }

    const worker = new Worker(
      queueName,
      async (job) => processor(job.data as Record<string, unknown>, job),
      {
        connection: this.connection
      }
    );
    this.workers.set(queueName, worker);

    return {
      started: true,
      queueName,
      existing: false
    };
  }

  async onModuleDestroy() {
    await Promise.all([
      ...Array.from(this.workers.values()).map((worker) => worker.close()),
      ...Array.from(this.queues.values()).map((queue) => queue.close())
    ]);
  }

  private async enqueue(queueName: string, jobName: string, data: Record<string, unknown>, dedupeId?: string) {
    if (!this.enabled) {
      return {
        queued: false,
        queueName,
        reason: "BullMQ is disabled; set BULLMQ_ENABLED=true to enqueue jobs."
      };
    }

    const queue = this.getQueue(queueName);
    const jobId = dedupeId ? `${queueName}-${dedupeId}` : undefined;
    if (jobId) {
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "failed") await existing.retry();
        if (state !== "completed") return { queued: true, queueName, jobId, deduplicated: true, state };
        await existing.remove();
      }
    }
    const job = await queue.add(jobName, data, {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000
      },
      removeOnComplete: 1000,
      removeOnFail: 1000
    });

    return {
      queued: true,
      queueName,
      jobId: String(job.id)
    };
  }

  private getQueue(name: string) {
    const existing = this.queues.get(name);

    if (existing) {
      return existing;
    }

    const queue = new Queue(name, {
      connection: this.connection
    });
    this.queues.set(name, queue);

    return queue;
  }

  private parseRedisConnection(redisUrl: string): QueueConnection {
    const parsed = new URL(redisUrl);

    return {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined
    };
  }
}

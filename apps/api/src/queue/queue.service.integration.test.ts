import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueueService } from "./queue.service";

describe("QueueService integration", () => {
  it("keeps BullMQ disabled unless explicitly enabled", async () => {
    const previous = process.env.BULLMQ_ENABLED;
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();

    try {
      const result = await queueService.enqueueAiJob({
        jobId: "job-test",
        type: "GOAL_PLAN_GENERATION",
        goalId: "goal-test",
        userId: "user-test"
      });

      assert.equal(queueService.isEnabled(), false);
      assert.equal(result.queued, false);
      assert.equal(result.queueName, "ai-jobs");
    } finally {
      await queueService.onModuleDestroy();

      if (previous === undefined) {
        delete process.env.BULLMQ_ENABLED;
      } else {
        process.env.BULLMQ_ENABLED = previous;
      }
    }
  });

  it("keeps workers disabled unless BullMQ is enabled", async () => {
    const previous = process.env.BULLMQ_ENABLED;
    process.env.BULLMQ_ENABLED = "false";
    const queueService = new QueueService();

    try {
      const result = queueService.createWorker("ai-jobs", async () => ({
        processed: true
      }));

      assert.equal(result.started, false);
      assert.equal(result.queueName, "ai-jobs");
    } finally {
      await queueService.onModuleDestroy();

      if (previous === undefined) {
        delete process.env.BULLMQ_ENABLED;
      } else {
        process.env.BULLMQ_ENABLED = previous;
      }
    }
  });

  it("enqueues AI jobs into BullMQ when enabled", async () => {
    const previousEnabled = process.env.BULLMQ_ENABLED;
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.BULLMQ_ENABLED = "true";
    process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
    const queueService = new QueueService();

    try {
      const result = await queueService.enqueueAiJob({
        jobId: "job-enabled-test",
        type: "GOAL_PLAN_GENERATION",
        goalId: "goal-enabled-test",
        userId: "user-enabled-test"
      });

      assert.equal(queueService.isEnabled(), true);
      assert.equal(result.queued, true);
      assert.equal(result.queueName, "ai-jobs");
      assert.ok(result.jobId);
    } finally {
      await queueService.onModuleDestroy();

      if (previousEnabled === undefined) {
        delete process.env.BULLMQ_ENABLED;
      } else {
        process.env.BULLMQ_ENABLED = previousEnabled;
      }

      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }
  });
});

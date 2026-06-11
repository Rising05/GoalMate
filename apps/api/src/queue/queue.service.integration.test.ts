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
});

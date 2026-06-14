import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { QueueService } from "../queue/queue.service";
import { AiJobsService } from "./ai-jobs.service";

@Injectable()
export class AiJobsWorker implements OnModuleInit {
  constructor(
    @Inject(QueueService)
    private readonly queueService: QueueService,
    @Inject(AiJobsService)
    private readonly aiJobsService: AiJobsService
  ) {}

  onModuleInit() {
    if (process.env.BULLMQ_WORKERS_ENABLED !== "true") {
      return;
    }

    this.queueService.createWorker("ai-jobs", async (data) => {
      const jobId = typeof data.jobId === "string" ? data.jobId : "";

      if (!jobId) {
        throw new Error("AI worker payload is missing jobId.");
      }

      return this.aiJobsService.processQueuedAiJob(jobId);
    });
  }
}

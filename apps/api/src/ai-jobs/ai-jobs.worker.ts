import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { DailyTasksService } from "../daily-tasks/daily-tasks.service";
import { QueueService } from "../queue/queue.service";
import { AiJobsService } from "./ai-jobs.service";

const CHECKIN_SCORING = "CHECKIN_SCORING";

@Injectable()
export class AiJobsWorker implements OnModuleInit {
  constructor(
    @Inject(QueueService)
    private readonly queueService: QueueService,
    @Inject(AiJobsService)
    private readonly aiJobsService: AiJobsService,
    @Inject(DailyTasksService)
    private readonly dailyTasksService: DailyTasksService
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

      if (data.type === CHECKIN_SCORING) {
        return this.dailyTasksService.processQueuedCheckinScoringJob(jobId);
      }

      return this.aiJobsService.processQueuedAiJob(jobId);
    });
  }
}

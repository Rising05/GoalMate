import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { QueueService } from "../queue/queue.service";
import { GoalsService } from "./goals.service";

@Injectable()
export class GoalsReportWorker implements OnModuleInit {
  constructor(
    @Inject(QueueService)
    private readonly queueService: QueueService,
    @Inject(GoalsService)
    private readonly goalsService: GoalsService
  ) {}

  onModuleInit() {
    if (process.env.BULLMQ_WORKERS_ENABLED !== "true") {
      return;
    }

    this.queueService.createWorker("reports", async (data) =>
      this.goalsService.processQueuedReportJob(data)
    );
  }
}

import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { Job } from "bullmq";
import { QueueService } from "../queue/queue.service";
import { NotificationsService } from "./notifications.service";

@Injectable()
export class NotificationsWorker implements OnModuleInit {
  constructor(
    @Inject(QueueService)
    private readonly queueService: QueueService,
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService
  ) {}

  onModuleInit() {
    if (process.env.BULLMQ_WORKERS_ENABLED !== "true") {
      return;
    }

    this.queueService.createWorker("email", async (data, job) => {
      const emailLogId = typeof data.emailLogId === "string" ? data.emailLogId : "";

      if (!emailLogId) {
        throw new Error("Email worker payload is missing emailLogId.");
      }

      const result = await this.notificationsService.processQueuedEmailLog(
        emailLogId,
        {
          finalAttempt: this.isFinalAttempt(job)
        }
      );

      if (result.retryable) {
        throw new Error(result.log.error ?? "Email worker delivery failed.");
      }

      return result;
    });
  }

  private isFinalAttempt(job: Job) {
    const maxAttempts = Number(job.opts.attempts ?? 1);

    return job.attemptsMade + 1 >= maxAttempts;
  }
}
